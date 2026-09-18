import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { requireBackendNetwork } from '@/api/runtime'
import { ApiError, authApi, queryKeys, setCsrfToken } from '@/api'
import { SessionContext, type SessionContextValue } from '@/app/session-context'
import { WalletContext } from '@/app/wallet-context'
import { NimiqOperationError, currentTransport, initWalletRuntime } from '@/lib/nimiq'
import type { WalletTransport } from '@/lib/nimiq'
import type { AuthChallenge, AuthFlowState, AuthSession } from '@/types/auth'

/**
 * Owns the Nimpass application session.
 *
 * One authentication model, whichever wallet transport is underneath
 * (docs/09-SECURITY.md §12-§20):
 *
 *   requestAccount()          → wallet names an address the user approved
 *   POST /auth/challenges     → backend mints nonce + exact message
 *   signChallenge(message)    → wallet signs that message
 *   POST /auth/sessions       → backend verifies signature, challenge, purpose
 *   session                   → backend-issued, server-owned
 *
 * Inside Nimiq Pay the two wallet steps are native sheets; in an ordinary
 * browser they are Nimiq Hub windows. The steps, the challenge, the contract
 * and the session are identical — only the transport differs, and this file
 * never asks which one it got.
 *
 * Three rules shape the implementation:
 *
 *  - An address from a wallet is not an authenticated session. Only the
 *    backend's verify response creates one (§11, §19).
 *  - Nimpass never invents the signed text. The backend issues the exact
 *    message and reconstructs it during verification (§14, §18).
 *  - Wallet dialogs are sequenced behind user actions and never fired
 *    concurrently (docs/04-NIMIQ-MINI-APPS.md §24, §56).
 *
 * ## Why sign-in can pause
 *
 * Both runtimes stop at WALLET_SELECTED after account selection. A separate
 * user action signs the challenge. For Hub this also preserves the browser's
 * one-popup-per-click rule; for native Pay it avoids consecutive approval
 * sheets without a separate user action.
 *
 * The challenge request is *started* before the pause and handed to the wallet
 * as a promise, so `completeSignIn` reaches the Hub with nothing awaited in
 * between. Awaiting it first is precisely what gets a popup blocked
 * (https://nimiq.dev/hub/getting-started).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  // Read through the raw context rather than `useWallet()`: the session is the
  // one thing that must still render when no wallet runtime is mounted at all.
  const walletRuntime = useContext(WalletContext)
  const noteAccount = walletRuntime?.noteAccount ?? noop
  const [flow, setFlow] = useState<AuthFlowState>({ kind: 'IDLE' })
  const inFlight = useRef(false)
  /**
   * The half-finished sign-in a `WALLET_SELECTED` pause is holding.
   *
   * The challenge promise lives here rather than the resolved challenge so the
   * signature step can hand it to the wallet untouched. The resolved challenge
   * is kept alongside it for the id the verify call needs.
   */
  const pending = useRef<{
    transport: WalletTransport
    wallet: string
    challenge: Promise<AuthChallenge>
  } | null>(null)

  // Session recovery: survives refresh, navigation, WebView reload and the
  // return trip from a wallet approval (docs/09 §61-§64).
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session(),
    // The contract answers 401 for a visitor who is not signed in, which is the
    // ordinary case rather than a failure. Converting it to `null` here keeps
    // "nobody is signed in" out of the error path entirely.
    queryFn: async ({ signal }) => {
      try {
        return await authApi.getAuthSession(signal)
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) return null
        throw error
      }
    },
    retry: false,
    staleTime: 60_000,
  })

  const session = sessionQuery.data ?? null

  // Keep the API client's CSRF token in step with whatever session we hold,
  // including one recovered after a refresh.
  setCsrfToken(session?.csrfToken ?? null)

  /**
   * Finishes a sign-in: sign the challenge, then let the backend decide.
   *
   * Called either straight through from `signIn` (Nimiq Pay) or from a second
   * user action (the Hub). Nothing is awaited before `signChallenge`, so a
   * transport that opens a popup still has the click's permission to do it.
   */
  const completeSignIn = useCallback(
    async (attempt: {
      transport: WalletTransport
      wallet: string
      challenge: Promise<AuthChallenge>
    }): Promise<AuthSession | null> => {
      const { transport, wallet, challenge } = attempt

      setFlow({ kind: 'AWAITING_SIGNATURE', wallet })

      let signature
      try {
        // The challenge promise goes to the wallet as a promise. The Mini App
        // adapter awaits it; the Hub adapter opens its window first and awaits
        // it after — which is the whole reason this is not `await`ed here.
        signature = await transport.signChallenge(
          challenge.then((issued) => ({ wallet, message: issued.message })),
        )
      } catch (error) {
        // A challenge request that failed surfaces here, because the wallet
        // call is what was waiting on it.
        setFlow(error instanceof ApiError ? flowFromApiError(error, 'CHALLENGE_UNAVAILABLE') : flowFromWalletError(error))
        return null
      }

      let issued: AuthChallenge
      try {
        issued = await challenge
      } catch (error) {
        setFlow(flowFromApiError(error, 'CHALLENGE_UNAVAILABLE'))
        return null
      }

      setFlow({ kind: 'VERIFYING', challenge: issued })

      // The proof and the session recovery fail the same way on the wire — both
      // answer 401 — but they mean opposite things: the first says the wallet's
      // signature was refused, the second says it was accepted and the browser
      // dropped the cookie. Telling a customer their signature was accepted when
      // it was rejected sends them to fix cookies while the real cause is the
      // signature, so the two live in separate try blocks.
      let verified: AuthSession
      try {
        verified = await authApi.verifyAuthSignature({
          challengeId: issued.id,
          // Echo the challenge's wallet, not the Hub's user-friendly spelling.
          // chooseAddress() returns "NQ41 CDMJ …" (44 characters); the backend
          // stores the compact form the challenge was bound to (§19).
          wallet: issued.wallet,
          publicKey: signature.publicKey,
          signature: signature.signature,
          // Only a transport that documents its own preprocessing names a
          // scheme; otherwise the backend's configured default stands.
          signingScheme: transport.signingScheme,
        })
      } catch (error) {
        setCsrfToken(null)
        setFlow(flowFromApiError(error, 'VERIFICATION_FAILED'))
        return null
      }

      try {
        // A proof response alone does not establish that the browser accepted
        // the cookie. Read the session back before unlocking private UI.
        setCsrfToken(verified.csrfToken)
        await queryClient.cancelQueries({ queryKey: queryKeys.auth.session() })
        const recovered = await recoverVerifiedSession(verified.identity.id)
        await clearPrivateQueries(queryClient)
        queryClient.setQueryData(queryKeys.auth.session(), recovered)
        // Provider and pass data are per-identity; drop anything cached for
        // nobody in particular.
        void queryClient.invalidateQueries({ queryKey: queryKeys.passes.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.provider.all })
        setFlow({ kind: 'AUTHENTICATED', session: verified })
        return verified
      } catch (error) {
        setCsrfToken(null)
        setFlow(error instanceof ApiError && error.isUnauthorized
          ? { kind: 'FAILED', reason: 'VERIFICATION_FAILED', message: 'Your signature was accepted, but the browser did not keep the session cookie. Open the configured Nimpass URL and allow cookies, then log in again.' }
          : flowFromApiError(error, 'VERIFICATION_FAILED'))
        return null
      }
    },
    [queryClient],
  )

  const signIn = useCallback(async (): Promise<AuthSession | null> => {
    // One sign-in at a time: two concurrent attempts would stack wallet dialogs.
    if (inFlight.current) return null
    inFlight.current = true

    try {
      // Resuming a paused attempt: the address and challenge already exist, and
      // this click exists to spend its popup on the signature.
      const resumed = pending.current
      if (resumed) {
        pending.current = null
        return await completeSignIn(resumed)
      }

      // The transport is read synchronously. `WalletProvider` resolved it on
      // mount precisely so that this line does not have to await anything — an
      // await here would cost the Hub its popup.
      let transport = currentTransport()
      if (!transport) {
        // Detection has not settled, or there is genuinely no wallet here.
        const runtime = await initWalletRuntime()
        transport = runtime.transport
        if (!transport) {
          setFlow({
            kind: 'FAILED',
            reason: 'WALLET_UNAVAILABLE',
            message: runtime.error?.message ?? "We couldn't reach a Nimiq wallet from here.",
          })
          return null
        }
        // A Hub window needs this click's popup permission, which the await
        // just spent. Do not report "no wallet" — the next press opens it.
        // Mini App sheets are not popups, so this click can continue.
        if (transport.gesturePerOperation) {
          setFlow({ kind: 'IDLE' })
          return null
        }
      }

      // 1. Account access. Opens a native sheet or a Hub window.
      setFlow({ kind: 'REQUESTING_ACCOUNT' })
      let wallet: string
      try {
        wallet = await transport.requestAccount()
        // The runtime now knows which account answered, without asking again.
        // Everything authorisation-bearing still comes from the
        // backend-verified session below (docs/09-SECURITY.md §11, §19).
        noteAccount(wallet)
      } catch (error) {
        setFlow(flowFromWalletError(error))
        return null
      }

      // 2. Challenge. The backend owns the nonce and the exact message text.
      //    `ChallengeInput` is `{ wallet }` and nothing else — the schema is
      //    additionalProperties:false, so the purpose rides on the endpoint.
      setFlow({ kind: 'REQUESTING_CHALLENGE', wallet })
      const challenge = requireBackendNetwork().then(() => authApi.requestAuthChallenge({ wallet }))
      // Nothing is allowed to observe this promise as unhandled while the flow
      // pauses; the flow reads it again below or in the resumed step.
      challenge.catch(() => {})

      // Pause after account selection in both runtimes. A separate click
      // requests the signature; for Hub this also preserves popup permission.
      // A failed challenge must not leave an apparently ready sign button.
      try {
        const issued = await challenge
        pending.current = { transport, wallet, challenge }
        // Native account access and signing each require explicit intent too.
        setFlow({ kind: 'WALLET_SELECTED', wallet, challenge: issued })
        return null
      } catch (error) {
        setFlow(flowFromApiError(error, 'CHALLENGE_UNAVAILABLE'))
        return null
      }
    } finally {
      inFlight.current = false
    }
  }, [completeSignIn, noteAccount])

  const signOut = useCallback(async () => {
    try {
      await authApi.logout()
    } catch (error) {
      // 401 means this cookie no longer names an active session. Other errors
      // must stay visible: never claim logout while revocation is unconfirmed.
      if (!(error instanceof ApiError && error.isUnauthorized)) throw error
    }
    await queryClient.cancelQueries({ queryKey: queryKeys.auth.session() })
    await clearPrivateQueries(queryClient)
    setCsrfToken(null)
    pending.current = null
    // The wallet may still hold an approved account, but Nimpass has no reason
    // to remember which one once nobody is signed in.
    noteAccount(null)
    queryClient.setQueryData(queryKeys.auth.session(), null)
    queryClient.removeQueries({ queryKey: queryKeys.passes.all })
    queryClient.removeQueries({ queryKey: queryKeys.provider.all })
    setFlow({ kind: 'IDLE' })
  }, [noteAccount, queryClient])

  const resetFlow = useCallback(() => {
    // A paused attempt is abandoned with the dialog that was showing it. Its
    // challenge stays unconsumed on the server and expires on its own TTL.
    pending.current = null
    setFlow({ kind: 'IDLE' })
  }, [])

  /**
   * Drops the local session as soon as *any* request reports the server no
   * longer accepts it.
   *
   * A session can end while the tab sits open: it expires, it is revoked, or
   * the user signs in elsewhere. Without this the header keeps showing a
   * signed-in wallet while every protected query fails underneath — the UI
   * asserting an authorisation state the server has already withdrawn
   * (docs/09-SECURITY.md §64-§66, docs/02-USER-FLOWS.md §91).
   *
   * Clearing is the safe direction: it fails closed, and the worst case is one
   * extra sign-in (§124). Authorisation-sensitive cached data goes with it, so
   * one wallet's passes can never be left on screen for another (§66).
   */
  useEffect(() => {
    const cache = queryClient.getQueryCache()
    return cache.subscribe((event) => {
      if (event.type !== 'updated' || event.query.state.status !== 'error') return
      const error = event.query.state.error
      if (!(error instanceof ApiError) || !error.isUnauthorized) return
      // The session query answering 401 is just "nobody is signed in".
      if (event.query.queryKey[0] === 'auth') return
      if (queryClient.getQueryData(queryKeys.auth.session()) == null) return

      setCsrfToken(null)
      queryClient.setQueryData(queryKeys.auth.session(), null)
      void clearPrivateQueries(queryClient)
      setFlow({
        kind: 'FAILED',
        reason: 'VERIFICATION_FAILED',
        message: 'Your session has ended. Log in again to continue.',
      })
    })
  }, [queryClient])

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      isRecovering: sessionQuery.isPending,
      flow,
      signIn,
      signOut,
      resetFlow,
    }),
    [session, sessionQuery.isPending, flow, signIn, signOut, resetFlow],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/**
 * Reads the cookie-backed session after a successful proof.
 *
 * Set-Cookie from the verify response is sometimes not visible to the very
 * next GET in the same tick. One or two empty retries recover a login that
 * already succeeded, instead of telling the user it failed and making them
 * sign again.
 */
async function recoverVerifiedSession(identityId: string): Promise<AuthSession> {
  let unauthorized: ApiError | null = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const recovered = await authApi.getAuthSession()
      if (recovered.identity.id !== identityId) {
        throw new Error('The browser did not recover the verified session.')
      }
      return recovered
    } catch (error) {
      if (!(error instanceof ApiError) || !error.isUnauthorized) throw error
      unauthorized = error
    }
  }
  throw unauthorized ?? new Error('The browser did not recover the verified session.')
}

/** A dismissed wallet dialog is a cancellation, never a failure (§31, FAQ). */
function flowFromWalletError(error: unknown): AuthFlowState {
  if (error instanceof NimiqOperationError) {
    if (error.isUserRejection) return { kind: 'CANCELLED' }
    if (error.kind === 'NO_ACCOUNTS') {
      return { kind: 'FAILED', reason: 'NO_ACCOUNTS', message: error.message }
    }
    if (error.kind === 'POPUP_BLOCKED') {
      // Recoverable, and the remedy is the user's to apply — so this offers a
      // retry rather than reading as "no wallet here".
      return { kind: 'FAILED', reason: 'POPUP_BLOCKED', message: error.message }
    }
    if (
      error.kind === 'PROVIDER_UNAVAILABLE' ||
      error.kind === 'PROVIDER_TIMEOUT' ||
      error.kind === 'PROVIDER_INIT_FAILED'
    ) {
      return { kind: 'FAILED', reason: 'WALLET_UNAVAILABLE', message: error.message }
    }
    return { kind: 'FAILED', reason: 'UNKNOWN', message: error.message }
  }
  return {
    kind: 'FAILED',
    reason: 'UNKNOWN',
    message: 'Something went wrong with the wallet request. Please try again.',
  }
}

function flowFromApiError(
  error: unknown,
  fallback: 'CHALLENGE_UNAVAILABLE' | 'VERIFICATION_FAILED',
): AuthFlowState {
  if (error instanceof ApiError) {
    if (error.isNetworkError) {
      return {
        kind: 'FAILED',
        reason: 'NETWORK',
        message: "We couldn't reach Nimpass. Check your connection and try again.",
      }
    }
    if (error.code === 'CHALLENGE_EXPIRED') {
      return {
        kind: 'FAILED',
        reason: 'CHALLENGE_EXPIRED',
        message: 'That sign-in request expired. Try again.',
      }
    }
    // The backend refused the proof itself. Say that plainly: the previous copy
    // for this case blamed the browser's cookies, which sent people to change
    // settings that were never the problem.
    if (error.code === 'INVALID_SIGNATURE') {
      return {
        kind: 'FAILED',
        reason: fallback,
        message: 'Your wallet signed, but Nimpass could not verify that signature. Sign in with the wallet you selected, on the same network, and try again.',
      }
    }
    return { kind: 'FAILED', reason: fallback, message: error.message }
  }
  return { kind: 'FAILED', reason: fallback, message: error instanceof Error ? error.message : 'Sign-in could not be completed.' }
}

/** No wallet runtime mounted: there is no account state to record. */
function noop(): void {}

const privateRoots = new Set(['passes', 'provider', 'purchases', 'redemptions'])
async function clearPrivateQueries(client: QueryClient): Promise<void> {
  const filter = { predicate: (query: { queryKey: readonly unknown[] }) => privateRoots.has(String(query.queryKey[0])) }
  await client.cancelQueries(filter)
  client.removeQueries(filter)
}
