import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ApiError, authApi, queryKeys, setCsrfToken } from '@/api'
import { SessionContext, type SessionContextValue } from '@/app/session-context'
import { NimiqOperationError, listAccounts, signMessage } from '@/lib/nimiq'
import type { AuthFlowState, AuthSession } from '@/types/auth'

/**
 * Owns the Nimpass application session.
 *
 * The flow, straight from docs/09-SECURITY.md §12-§20:
 *
 *   listAccounts()            → Nimiq Pay native dialog, user picks/approves
 *   POST /auth/challenge      → backend mints nonce + exact message
 *   sign(message)             → Nimiq Pay native dialog, signs that message
 *   POST /auth/verify         → backend verifies signature, challenge, purpose
 *   session                   → backend-issued, server-owned
 *
 * Two rules shape the implementation:
 *
 *  - An address from Nimiq Pay is not an authenticated session. Only the
 *    backend's verify response creates one (§11, §19).
 *  - The two native dialogs are sequenced behind one user action and never
 *    fired concurrently. The provider API documents which calls need
 *    confirmation but not how to sequence them, so this is a Nimpass rule
 *    (docs/04-NIMIQ-MINI-APPS.md §24, §56); `src/lib/nimiq/client.ts` enforces
 *    it for every caller, and the guard here keeps one sign-in from restarting
 *    itself.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [flow, setFlow] = useState<AuthFlowState>({ kind: 'IDLE' })
  const inFlight = useRef(false)

  // Session recovery: survives refresh, navigation, WebView reload and the
  // return trip from a Nimiq Pay approval sheet (docs/09 §61-§64).
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
  if (session?.csrfToken) setCsrfToken(session.csrfToken)

  const signIn = useCallback(async (): Promise<AuthSession | null> => {
    // One sign-in at a time: two concurrent attempts would stack native dialogs.
    if (inFlight.current) return null
    inFlight.current = true

    try {
      // 1. Account access. Opens a native dialog (official API: confirmation yes).
      setFlow({ kind: 'REQUESTING_ACCOUNT' })
      let wallet: string
      try {
        const accounts = await listAccounts()
        const first = accounts[0]
        if (!first) {
          setFlow({
            kind: 'FAILED',
            reason: 'NO_ACCOUNTS',
            message: 'No Nimiq account is available in this wallet.',
          })
          return null
        }
        wallet = first
      } catch (error) {
        setFlow(flowFromWalletError(error))
        return null
      }

      // 2. Challenge. The backend owns the nonce and the exact message text.
      setFlow({ kind: 'REQUESTING_CHALLENGE', wallet })
      let challenge
      try {
        // `ChallengeInput` is `{ wallet }` and nothing else — the schema is
        // additionalProperties:false, so the purpose rides on the endpoint.
        challenge = await authApi.requestAuthChallenge({ wallet })
      } catch (error) {
        setFlow(flowFromApiError(error, 'CHALLENGE_UNAVAILABLE'))
        return null
      }

      // 3. Signature. A second native dialog — this is a signature, not a
      //    payment, and the UI says so before we get here.
      setFlow({ kind: 'AWAITING_SIGNATURE', challenge })
      let signature
      try {
        signature = await signMessage(challenge.message)
      } catch (error) {
        setFlow(flowFromWalletError(error))
        return null
      }

      // 4. Verification. Only the backend decides this succeeded.
      setFlow({ kind: 'VERIFYING', challenge })
      try {
        const verified = await authApi.verifyAuthSignature({
          challengeId: challenge.id,
          // Echoed back so the backend can compare it with the challenge; it
          // derives the real signer from `publicKey` regardless (§19).
          wallet,
          publicKey: signature.publicKey,
          signature: signature.signature,
        })
        setCsrfToken(verified.csrfToken)
        queryClient.setQueryData(queryKeys.auth.session(), verified)
        // Provider and pass data are per-identity; drop anything cached for
        // nobody in particular.
        void queryClient.invalidateQueries({ queryKey: queryKeys.passes.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.provider.all })
        setFlow({ kind: 'AUTHENTICATED', session: verified })
        return verified
      } catch (error) {
        setFlow(flowFromApiError(error, 'VERIFICATION_FAILED'))
        return null
      }
    } finally {
      inFlight.current = false
    }
  }, [queryClient])

  const signOut = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Even if the call fails, drop the local view of the session: the server
      // remains the authority on whether it is really gone.
    }
    setCsrfToken(null)
    queryClient.setQueryData(queryKeys.auth.session(), null)
    queryClient.removeQueries({ queryKey: queryKeys.passes.all })
    queryClient.removeQueries({ queryKey: queryKeys.provider.all })
    setFlow({ kind: 'IDLE' })
  }, [queryClient])

  const resetFlow = useCallback(() => setFlow({ kind: 'IDLE' }), [])

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
      queryClient.removeQueries({ queryKey: queryKeys.passes.all })
      queryClient.removeQueries({ queryKey: queryKeys.provider.all })
      setFlow({
        kind: 'FAILED',
        reason: 'VERIFICATION_FAILED',
        message: 'Your session has ended. Sign in again to continue.',
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

/** A dismissed native dialog is a cancellation, never a failure (§31, FAQ). */
function flowFromWalletError(error: unknown): AuthFlowState {
  if (error instanceof NimiqOperationError) {
    if (error.isUserRejection) return { kind: 'CANCELLED' }
    if (error.kind === 'NO_ACCOUNTS') {
      return { kind: 'FAILED', reason: 'NO_ACCOUNTS', message: error.message }
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
    return { kind: 'FAILED', reason: fallback, message: error.message }
  }
  return { kind: 'FAILED', reason: fallback, message: 'Sign-in could not be completed.' }
}
