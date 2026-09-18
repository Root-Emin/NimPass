import { requireBackendNetwork } from '@/api/runtime'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, messageForApiError, queryKeys, redemptionsApi } from '@/api'
import { NimiqOperationError, currentTransport } from '@/lib/nimiq'
import type { PurchasedPass, RedemptionChallenge } from '@/types/domain'
import type { CustomerRedemptionState } from '@/types/redemption'

/**
 * Using one session from a pass you own.
 *
 * The ceremony, and why each step is where it is:
 *
 *   create     the backend issues a challenge and, with it, the exact canonical
 *              message to sign. Nimpass never composes that text — the nonce,
 *              the domain separation and every binding in it are the server's
 *              (docs/09-SECURITY.md §14, §51-§52).
 *   sign       the wallet shows its confirmation — Nimiq Pay's native dialog
 *              inside the Mini App, the Nimiq Hub's window in an ordinary
 *              browser. We pass the message through byte-for-byte and forward
 *              what comes back unchanged.
 *   authorize  the backend verifies the signature and consumes exactly one
 *              session in the same transaction. That response is the redemption.
 *
 * There is no fourth step. Nimpass used to mint a short-lived reference here
 * and wait for a provider to confirm it on their own device; a pass is now used
 * by the person who owns it, so the signature that proves ownership is also
 * what spends the session (docs/01-PRODUCT.md §24-§25).
 *
 * What this hook never does is the interesting part. It does not decrement a
 * balance and does not decide a session was used: the counts in `CONSUMED` are
 * the ones the backend wrote inside its own transaction, and a dismissed wallet
 * dialog is not a failure (docs/08-ARCHITECTURE.md §49-§50).
 */

export interface SessionRedemption {
  state: CustomerRedemptionState
  /**
   * Creates a challenge and stops, showing what signing will do.
   *
   * Deliberately does not open the wallet. A native signature request that
   * appears without warning, moments after a customer bought something with
   * NIM, reads as a second payment — so the explanation comes first and
   * `proceed` opens the dialog (§7). It matters more now than it used to:
   * signing is no longer a step towards using a session, it *is* using one.
   */
  begin: () => Promise<void>
  /** Opens the wallet's confirmation, then spends the session. */
  proceed: () => Promise<void>
  /** Closes the sheet. Any live challenge stays server-side, unspent. */
  dismiss: () => void
  /** Looks for an unsigned challenge left over from before a reload. */
  recover: () => Promise<void>
}

export function useSessionRedemption(pass: PurchasedPass | undefined): SessionRedemption {
  const queryClient = useQueryClient()
  const [state, setState] = useState<CustomerRedemptionState>({ kind: 'IDLE' })

  const mounted = useRef(true)
  const starting = useRef(false)
  /*
   * Guards the signing step. A double tap must never become two signatures.
   *
   * This is a UX lock and nothing more: a challenge is single-use and the
   * backend enforces that inside the consuming transaction, refusing the second
   * authorization rather than spending a second session. Presenting this as the
   * safety mechanism would be a lie (docs/09-SECURITY.md §41).
   */
  const signing = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const safeSet = useCallback((next: CustomerRedemptionState) => {
    if (mounted.current) setState(next)
  }, [])

  const refreshPass = useCallback(
    (passId: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.passes.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.redemptions.pass(passId) })
    },
    [queryClient],
  )

  /** Maps a backend rejection onto the state that explains it. */
  const fromError = useCallback(
    (error: unknown, challenge: RedemptionChallenge | null): CustomerRedemptionState => {
      if (!(error instanceof ApiError)) {
        return { kind: 'UNCERTAIN', message: messageForApiError(error) }
      }
      switch (error.code) {
        case 'REDEMPTION_CHALLENGE_EXPIRED':
          return { kind: 'EXPIRED' }
        case 'STALE_REDEMPTION_CHALLENGE':
          return { kind: 'STALE' }
        case 'REDEMPTION_ALREADY_CONSUMED':
          return { kind: 'ALREADY_CONSUMED' }
        case 'PASS_COMPLETED':
          return { kind: 'PASS_COMPLETED' }
        case 'PASS_EXPIRED':
          return { kind: 'PASS_EXPIRED' }
        case 'INVALID_REDEMPTION_SIGNATURE':
          return { kind: 'INVALID_SIGNATURE', challenge }
        case 'PASS_NOT_OWNED':
        case 'AUTH_REQUIRED':
        case 'CSRF_INVALID':
          return { kind: 'AUTH_REQUIRED' }
        default:
          if (error.isUnauthorized) return { kind: 'AUTH_REQUIRED' }
          // An outcome this build does not model is never silent success. It
          // says so, and offers a fresh attempt (§9). This matters most here:
          // a request that failed in an unmodelled way may or may not have
          // spent a session, and only the pass itself can settle that.
          return { kind: 'UNCERTAIN', message: messageForApiError(error) }
      }
    },
    [],
  )

  /**
   * Signs the challenge and spends the session.
   *
   * Reached straight from the customer's press, and nothing is awaited before
   * the wallet call — in an ordinary browser the wallet is the Nimiq Hub, which
   * opens a window, and browsers only permit that while the click is being
   * handled (https://nimiq.dev/hub/getting-started). The challenge is already
   * in hand from `begin`, so there is nothing to fetch first.
   */
  const authorize = useCallback(
    async (challenge: RedemptionChallenge, passId: string, ownerWallet: string) => {
      const transport = currentTransport()
      if (!transport) {
        safeSet({
          kind: 'UNCERTAIN',
          message: "We couldn't reach your wallet to use this session.",
        })
        return
      }

      safeSet({ kind: 'SIGNING', challenge })

      let signed
      try {
        // The backend's exact string, untouched. Reconstructing, trimming or
        // prefixing it would sign different bytes than the ones the server will
        // verify — and the server is right to reject that (§5).
        signed = await transport.signChallenge(
          requireBackendNetwork().then(() => ({ wallet: ownerWallet, message: challenge.message })),
        )
      } catch (error) {
        if (error instanceof NimiqOperationError && error.isUserRejection) {
          // Dismissing the confirmation is a normal outcome, not a system
          // failure — and nothing was spent, because the signature never
          // reached the backend (§8).
          safeSet({ kind: 'CANCELLED', challenge })
          return
        }
        safeSet({
          kind: 'UNCERTAIN',
          message:
            error instanceof NimiqOperationError
              ? error.message
              : "We couldn't reach your wallet to use this session.",
        })
        return
      }

      safeSet({ kind: 'AUTHORIZING', challenge })
      try {
        // publicKey and signature forwarded exactly as the wallet produced
        // them. `signingScheme` travels with them only when the transport
        // documents its own preprocessing, so the Mini App path stays on the
        // backend's configured default (see `src/api/redemptions.ts`).
        const consumed = await redemptionsApi.authorizeRedemption(challenge.challengeId, {
          publicKey: signed.publicKey,
          signature: signed.signature,
          signingScheme: transport.signingScheme,
        })
        refreshPass(passId)
        // Straight from the response. The backend wrote these counts inside the
        // transaction that spent the session; nothing here subtracts one.
        safeSet({
          kind: 'CONSUMED',
          remainingSessions: consumed.pass.remainingSessions,
          completed: consumed.pass.status === 'COMPLETED',
        })
      } catch (error) {
        // The pass may or may not have moved, so re-read it either way rather
        // than leaving a stale count on screen behind the error.
        refreshPass(passId)
        safeSet(fromError(error, challenge))
      }
    },
    [fromError, refreshPass, safeSet],
  )

  const begin = useCallback(async () => {
    if (!pass) return
    // One challenge request at a time. A double tap would otherwise create a
    // second challenge and invalidate the first — and the backend's one-active
    // constraint would make the race's loser disappear mid-ceremony.
    if (starting.current) return
    starting.current = true

    try {
      safeSet({ kind: 'CREATING_CHALLENGE' })
      const challenge = await redemptionsApi.createRedemptionChallenge(pass.id)
      if (challenge.status !== 'CREATED') {
        // A challenge that is not awaiting a signature has nothing left to
        // give: it was spent, or it ran out. Start over rather than sign
        // something the backend will refuse.
        safeSet({ kind: challenge.status === 'CONSUMED' ? 'ALREADY_CONSUMED' : 'EXPIRED' })
        return
      }

      // Stop here. The customer reads what they are approving, then acts.
      safeSet({ kind: 'AWAITING_SIGNATURE', challenge })
    } catch (error) {
      safeSet(fromError(error, null))
    } finally {
      starting.current = false
    }
  }, [fromError, pass, safeSet])

  /** The second half: open the wallet for the challenge already in hand. */
  const proceed = useCallback(async () => {
    if (!pass) return
    if (state.kind !== 'AWAITING_SIGNATURE') return
    if (signing.current) return
    signing.current = true
    try {
      // The pass's own owner wallet, so a transport that can pin the signer
      // does. The backend still derives the real signer from the returned
      // public key and checks it against the challenge (docs/09-SECURITY.md
      // §19).
      await authorize(state.challenge, pass.id, pass.ownerWallet)
    } finally {
      signing.current = false
    }
  }, [authorize, pass, state])

  /**
   * Finds a challenge left behind by a reload, without creating one.
   *
   * Uses the read-only `current` endpoint. A 404 means there is nothing in
   * flight, which is the normal case and not an error. Only an unsigned
   * challenge can be resumed — a signed one has already been spent, and there
   * is no in-between state left to recover into.
   */
  const recover = useCallback(async () => {
    if (!pass) return
    try {
      const current = await redemptionsApi.getCurrentRedemptionChallenge(pass.id)
      if (current.status === 'CREATED') {
        safeSet({ kind: 'AWAITING_SIGNATURE', challenge: current })
      }
    } catch {
      // No active challenge, or unreadable. Either way there is nothing to
      // resume and nothing alarming to report.
    }
  }, [pass, safeSet])

  const dismiss = useCallback(() => {
    safeSet({ kind: 'IDLE' })
  }, [safeSet])

  return { state, begin, proceed, dismiss, recover }
}
