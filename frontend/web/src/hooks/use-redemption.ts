import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, messageForApiError, queryKeys, redemptionsApi } from '@/api'
import { NimiqOperationError, signMessage } from '@/lib/nimiq'
import { useRevalidateOnForeground } from '@/hooks/use-foreground'
import { secondsUntil } from '@/lib/format'
import type { Pass, RedemptionChallenge } from '@/types/domain'
import type { CustomerRedemptionState } from '@/types/redemption'

/**
 * The customer half of a redemption.
 *
 * The ceremony, and why each step is where it is:
 *
 *   create     the backend issues a challenge and, with it, the exact canonical
 *              message to sign. Nimpass never composes that text — the nonce,
 *              the domain separation and every binding in it are the server's
 *              (docs/09-SECURITY.md §14, §51-§52).
 *   sign       Nimiq Pay shows its native dialog. We pass the message through
 *              byte-for-byte and forward what comes back unchanged.
 *   authorize  the backend verifies the signature and only then mints the
 *              short-lived NR1 reference. Authorising is not redeeming.
 *   wait       the provider confirms. That is the only call that consumes a
 *              session, and it happens on their device, not this one.
 *
 * What this hook never does is the interesting part. It does not decrement a
 * balance, does not decide a session was used, does not mint or reconstruct a
 * reference, and does not treat a dismissed wallet dialog as a failure.
 * Consumption is one atomic backend transaction, and the only honest thing a
 * customer's device can do is ask what the pass says now
 * (docs/08-ARCHITECTURE.md §49-§50).
 */

/** How often to re-read while a reference is live, waiting on the provider. */
const WATCH_INTERVAL_MS = 4_000

export interface SessionRedemption {
  state: CustomerRedemptionState
  /**
   * Creates a challenge and stops, showing what signing will authorise.
   *
   * Deliberately does not open the wallet. A native signature request that
   * appears without warning, moments after a customer bought something with
   * NIM, reads as a second payment — so the explanation comes first and
   * `proceed` opens the dialog (§7).
   */
  begin: () => Promise<void>
  /** Opens Nimiq Pay's native dialog for the challenge `begin` created. */
  proceed: () => Promise<void>
  /** Re-issues a reference for an already-authorised challenge (§14). */
  restoreReference: () => Promise<void>
  /** Closes the sheet. Any live challenge stays server-side. */
  dismiss: () => void
  /** Looks for an authorised challenge left over from before a reload. */
  recover: () => Promise<void>
}

export function useSessionRedemption(pass: Pass | undefined): SessionRedemption {
  const queryClient = useQueryClient()
  const [state, setState] = useState<CustomerRedemptionState>({ kind: 'IDLE' })

  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const starting = useRef(false)

  const stopWatching = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopWatching()
    }
  }, [stopWatching])

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

  /**
   * Watches an authorised challenge until the provider resolves it.
   *
   * Resolution is read from the challenge itself — `status: CONSUMED`, which is
   * the backend stating a fact — rather than inferred from a shrinking session
   * count. Comparing counts would guess, and would credit *this* challenge with
   * a decrement that a different redemption may have caused (§42).
   */
  const watch = useCallback(
    (challengeId: string, passId: string) => {
      stopWatching()
      const controller = new AbortController()
      abortRef.current = controller

      timer.current = setInterval(() => {
        if (!mounted.current) return

        // Local countdown, for presentation only. When it reaches zero the UI
        // stops offering the code, but the backend remains the authority on
        // whether the challenge is still usable — a client clock must never
        // make a security decision (§16).
        setState((current) => {
          if (current.kind !== 'QR_READY') return current
          const secondsLeft = secondsUntil(current.challenge.expiresAt)
          return secondsLeft <= 0 ? { kind: 'EXPIRED' } : { ...current, secondsLeft }
        })

        void (async () => {
          try {
            const latest = await redemptionsApi.getRedemptionChallenge(challengeId, {
              signal: controller.signal,
            })
            if (!mounted.current) return

            if (latest.status === 'CONSUMED') {
              stopWatching()
              refreshPass(passId)
              // Counts come from the challenge's own pass snapshot, which the
              // backend wrote inside the consuming transaction.
              safeSet({
                kind: 'CONSUMED',
                remainingSessions: latest.pass.remainingSessions,
                completed: latest.pass.status === 'COMPLETED',
              })
              return
            }
            if (latest.status === 'EXPIRED' || latest.status === 'CANCELLED') {
              stopWatching()
              safeSet({ kind: 'EXPIRED' })
            }
          } catch {
            // A failed poll is not a failed redemption. Keep waiting; the
            // countdown still governs what the customer is shown.
          }
        })()
      }, WATCH_INTERVAL_MS)
    },
    [refreshPass, safeSet, stopWatching],
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
          // says so, and offers a fresh attempt rather than a stale code (§9).
          return { kind: 'UNCERTAIN', message: messageForApiError(error) }
      }
    },
    [],
  )

  /** Shows an authorised challenge's reference, or says it could not be issued. */
  const presentReference = useCallback(
    (challenge: RedemptionChallenge, passId: string) => {
      if (!challenge.redemptionReference) {
        // Authorised but no reference in this response. Recoverable by
        // rotating, never by inventing one (§11, §14).
        safeSet({ kind: 'AUTHORIZED_NO_REFERENCE', challenge })
        return
      }
      safeSet({
        kind: 'QR_READY',
        challenge,
        reference: challenge.redemptionReference,
        secondsLeft: secondsUntil(challenge.expiresAt),
      })
      watch(challenge.challengeId, passId)
    },
    [safeSet, watch],
  )

  /** Authorises a challenge: sign, forward, and show the reference. */
  const authorize = useCallback(
    async (challenge: RedemptionChallenge, passId: string) => {
      safeSet({ kind: 'SIGNING', challenge })

      let signed: { publicKey: string; signature: string }
      try {
        // The backend's exact string, untouched. Reconstructing, trimming or
        // prefixing it would sign different bytes than the ones the server will
        // verify — and the server is right to reject that (§5).
        signed = await signMessage(challenge.message)
      } catch (error) {
        if (error instanceof NimiqOperationError && error.isUserRejection) {
          // Dismissing the sheet is a normal outcome, not a system failure. No
          // reference was ever minted, so no provider can redeem anything (§8).
          safeSet({ kind: 'CANCELLED', challenge })
          return
        }
        safeSet({
          kind: 'UNCERTAIN',
          message: "We couldn't reach your wallet to authorise this session.",
        })
        return
      }

      safeSet({ kind: 'AUTHORIZING', challenge })
      try {
        // publicKey and signature forwarded exactly as Nimiq Pay returned them.
        const authorized = await redemptionsApi.authorizeRedemption(challenge.challengeId, {
          publicKey: signed.publicKey,
          signature: signed.signature,
        })
        presentReference(authorized, passId)
      } catch (error) {
        safeSet(fromError(error, challenge))
      }
    },
    [fromError, presentReference, safeSet],
  )

  const begin = useCallback(async () => {
    if (!pass) return
    // One challenge request at a time. A double tap would otherwise create a
    // second challenge and invalidate the first — and the backend's one-active
    // constraint would make the race's loser disappear mid-ceremony.
    if (starting.current) return
    starting.current = true
    stopWatching()

    try {
      safeSet({ kind: 'CREATING_CHALLENGE' })
      const challenge = await redemptionsApi.createRedemptionChallenge(pass.id)

      // Already authorised — a leftover from before a reload, rotated to a
      // fresh reference by the create call itself. No second signature needed.
      if (challenge.status === 'AUTHORIZED') {
        presentReference(challenge, pass.id)
        return
      }
      if (challenge.status !== 'CREATED') {
        safeSet({ kind: 'EXPIRED' })
        return
      }

      // Stop here. The customer reads what they are approving, then acts.
      safeSet({ kind: 'AWAITING_SIGNATURE', challenge })
    } catch (error) {
      safeSet(fromError(error, null))
    } finally {
      starting.current = false
    }
  }, [fromError, pass, presentReference, safeSet, stopWatching])

  /** The second half: open the wallet for the challenge already in hand. */
  const proceed = useCallback(async () => {
    if (!pass) return
    if (state.kind !== 'AWAITING_SIGNATURE') return
    await authorize(state.challenge, pass.id)
  }, [authorize, pass, state])

  /**
   * Re-issues a reference for a challenge that is already authorised.
   *
   * Posting to the create endpoint rotates the NR1 reference and returns the
   * new one, invalidating the previous. It is the contract's own recovery path
   * and needs no second signature, because the owner already signed this
   * challenge (§14, §15).
   */
  const restoreReference = useCallback(async () => {
    if (!pass) return
    if (starting.current) return
    starting.current = true
    try {
      const rotated = await redemptionsApi.createRedemptionChallenge(pass.id)
      presentReference(rotated, pass.id)
    } catch (error) {
      safeSet(fromError(error, null))
    } finally {
      starting.current = false
    }
  }, [fromError, pass, presentReference, safeSet])

  /**
   * Finds a challenge left behind by a reload, without creating one.
   *
   * Uses the read-only `current` endpoint, so it never rotates a reference the
   * customer may still have on another screen. A 404 means there is nothing in
   * flight, which is the normal case and not an error.
   */
  const recover = useCallback(async () => {
    if (!pass) return
    try {
      const current = await redemptionsApi.getCurrentRedemptionChallenge(pass.id)
      if (current.status === 'AUTHORIZED') {
        // Reading a challenge never returns a reference, so there is genuinely
        // nothing to show yet — offer the rotation rather than a dead QR.
        safeSet({ kind: 'AUTHORIZED_NO_REFERENCE', challenge: current })
        watch(current.challengeId, pass.id)
        return
      }
      if (current.status === 'CREATED') {
        safeSet({ kind: 'AWAITING_SIGNATURE', challenge: current })
      }
    } catch {
      // No active challenge, or unreadable. Either way there is nothing to
      // resume and nothing alarming to report.
    }
  }, [pass, safeSet, watch])

  /**
   * Coming back to a live code: re-read it before trusting the countdown.
   *
   * A backgrounded WebView stops the watch interval, so the seconds on screen
   * are whatever they were when the phone locked. The challenge may have
   * expired, or a provider may have redeemed it while the app was away — both
   * of which the backend knows and this device does not.
   */
  const liveChallengeId =
    state.kind === 'QR_READY' || state.kind === 'AUTHORIZED_NO_REFERENCE'
      ? state.challenge.challengeId
      : null

  useRevalidateOnForeground(
    useCallback(() => {
      if (!liveChallengeId || !pass) return
      void (async () => {
        try {
          const latest = await redemptionsApi.getRedemptionChallenge(liveChallengeId)
          if (latest.status === 'CONSUMED') {
            stopWatching()
            refreshPass(pass.id)
            safeSet({
              kind: 'CONSUMED',
              remainingSessions: latest.pass.remainingSessions,
              completed: latest.pass.status === 'COMPLETED',
            })
            return
          }
          if (latest.status !== 'AUTHORIZED' && latest.status !== 'CREATED') {
            stopWatching()
            safeSet({ kind: 'EXPIRED' })
            return
          }
          // Still live: correct the countdown from the server's own expiry
          // rather than from a timer that was asleep.
          setState((current) =>
            current.kind === 'QR_READY'
              ? { ...current, secondsLeft: secondsUntil(latest.expiresAt) }
              : current,
          )
        } catch {
          // Unreachable backend tells us nothing new; the watch keeps trying.
        }
      })()
    }, [liveChallengeId, pass, refreshPass, safeSet, stopWatching]),
    liveChallengeId !== null,
  )

  const dismiss = useCallback(() => {
    stopWatching()
    safeSet({ kind: 'IDLE' })
  }, [safeSet, stopWatching])

  return { state, begin, proceed, restoreReference, dismiss, recover }
}
