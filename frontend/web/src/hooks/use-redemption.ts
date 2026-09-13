import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, messageForApiError, passesApi, queryKeys, redemptionsApi } from '@/api'
import { NimiqOperationError, signMessage } from '@/lib/nimiq'
import { secondsUntil } from '@/lib/format'
import { createIdempotencyKey } from '@/lib/utils'
import type { Pass } from '@/types/domain'
import type { CustomerRedemptionState } from '@/types/redemption'

/**
 * The customer half of a redemption.
 *
 * What this hook does *not* do is the point of it. It never decrements a
 * balance, never decides a session was used, and never turns "the provider
 * probably scanned it" into success. Consumption happens inside one atomic
 * backend transaction (docs/08-ARCHITECTURE.md §50, docs/09-SECURITY.md §56),
 * and the only thing the customer's device can honestly do is ask the backend
 * what the pass says now.
 *
 * Resolution is therefore detected by re-reading the pass: when the
 * authoritative remaining count drops below what it was when this challenge
 * opened, a session was consumed and the new number comes from the server.
 *
 * That is a deliberate second choice. The direct signal — "challenge R1 reached
 * CONSUMED" — needs a redemption-status endpoint, and docs/08 §64 does not
 * define one, so inventing a path for it is out of scope. Reading the pass uses
 * only `GET /api/v1/me/passes/{id}`, which is documented, and it is
 * authoritative rather than a guess. When a status endpoint exists, this should
 * move to it: the pass read cannot distinguish *which* redemption consumed the
 * session, only that one did.
 */

/** How often to re-read the pass while a challenge is on screen. */
const PASS_POLL_INTERVAL_MS = 3_000

export interface SessionRedemption {
  state: CustomerRedemptionState
  /** Requests a fresh challenge. Consumes nothing (docs/09 §48). */
  begin: () => Promise<void>
  /** Signs the server-issued message, where the challenge requires it (§50). */
  authorize: () => Promise<void>
  /** Closes the sheet and stops watching. Any live challenge stays server-side. */
  dismiss: () => void
}

export function useSessionRedemption(pass: Pass | undefined): SessionRedemption {
  const queryClient = useQueryClient()
  const [state, setState] = useState<CustomerRedemptionState>({ kind: 'IDLE' })

  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** Remaining sessions when the current challenge opened. The comparison point. */
  const baseline = useRef<number | null>(null)
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

  /**
   * Runs every tick while a challenge is live: counts down, and asks the
   * backend whether the pass has changed.
   */
  const watch = useCallback(
    (passId: string) => {
      stopWatching()
      const controller = new AbortController()
      abortRef.current = controller

      timer.current = setInterval(() => {
        if (!mounted.current) return

        setState((current) => {
          if (current.kind !== 'PRESENTED') return current
          const secondsLeft = secondsUntil(current.challenge.expiresAt)
          // Expiry is a local clock reading, so it is only ever used to stop
          // *offering* the code. It never claims anything about the session —
          // the backend decides whether a challenge is still usable (§48).
          if (secondsLeft <= 0) return { kind: 'EXPIRED', challenge: current.challenge }
          return { ...current, secondsLeft }
        })

        void (async () => {
          try {
            const latest = await passesApi.getPass(passId, controller.signal)
            if (!mounted.current) return
            queryClient.setQueryData(queryKeys.passes.detail(passId), latest)

            const before = baseline.current
            if (before !== null && latest.remainingSessions < before) {
              stopWatching()
              baseline.current = null
              void queryClient.invalidateQueries({ queryKey: queryKeys.passes.all })
              safeSet({ kind: 'RESOLVED', remaining: latest.remainingSessions })
            }
          } catch {
            // A failed poll is not a failed redemption. Keep waiting; the
            // countdown still governs what the customer is told.
          }
        })()
      }, PASS_POLL_INTERVAL_MS)
    },
    [queryClient, safeSet, stopWatching],
  )

  const begin = useCallback(async () => {
    if (!pass) return
    // One challenge request at a time: a double tap would otherwise ask for two,
    // and the backend may invalidate the first when it issues the second (§49).
    if (starting.current) return
    starting.current = true

    try {
      safeSet({ kind: 'REQUESTING' })
      baseline.current = pass.remainingSessions

      const challenge = await redemptionsApi.createRedemptionChallenge(pass.id, {
        idempotencyKey: createIdempotencyKey(),
      })

      safeSet({
        kind: 'PRESENTED',
        challenge,
        secondsLeft: secondsUntil(challenge.expiresAt),
      })
      watch(pass.id)
    } catch (error) {
      baseline.current = null
      safeSet({ kind: 'FAILED', message: messageForApiError(error) })
    } finally {
      starting.current = false
    }
  }, [pass, safeSet, watch])

  /**
   * Signs the challenge through Nimiq Pay, when the backend says this pass
   * needs it.
   *
   * The message is handed to `sign()` exactly as issued. Nimpass never composes
   * signed text: the nonce, the domain separation and the binding are the
   * server's (docs/09-SECURITY.md §14, §51-§52).
   */
  const authorize = useCallback(async () => {
    if (state.kind !== 'PRESENTED') return
    const { challenge } = state
    if (!challenge.signingMessage) return

    safeSet({ kind: 'AWAITING_SIGNATURE', challenge })
    try {
      const signed = await signMessage(challenge.signingMessage)
      safeSet({ kind: 'AUTHORIZING', challenge })
      await redemptionsApi.authorizeRedemption(
        challenge.id,
        { signature: signed.signature, publicKey: signed.publicKey },
        { idempotencyKey: createIdempotencyKey() },
      )
      // Authorised, not consumed: the provider still has to confirm, and the
      // pass read is what will tell us when that happened.
      safeSet({ kind: 'PRESENTED', challenge, secondsLeft: secondsUntil(challenge.expiresAt) })
    } catch (error) {
      if (error instanceof NimiqOperationError && error.isUserRejection) {
        // Dismissing the wallet sheet is a normal outcome (docs/04 §31).
        safeSet({ kind: 'PRESENTED', challenge, secondsLeft: secondsUntil(challenge.expiresAt) })
        return
      }
      safeSet({
        kind: 'FAILED',
        message:
          error instanceof ApiError
            ? messageForApiError(error)
            : "We couldn't authorise this session. Try again.",
      })
    }
  }, [safeSet, state])

  const dismiss = useCallback(() => {
    stopWatching()
    baseline.current = null
    safeSet({ kind: 'IDLE' })
  }, [safeSet, stopWatching])

  return { state, begin, authorize, dismiss }
}
