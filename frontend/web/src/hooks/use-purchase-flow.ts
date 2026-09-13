import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, purchasesApi, queryKeys } from '@/api'
import {
  NIMIQ_NETWORK,
  NimiqOperationError,
  getNetworkReadiness,
  sendBasicTransactionWithData,
} from '@/lib/nimiq'
import { createIdempotencyKey } from '@/lib/utils'
import type { Purchase } from '@/types/domain'
import type { PaymentFailureReason, PaymentState } from '@/types/payment'
import { WALLET_ERROR_TO_FAILURE_REASON, paymentStateFromPurchase } from '@/types/payment'
import type { NimiqErrorKind } from '@/types/wallet'

/**
 * Drives one purchase attempt.
 *
 * The division of labour is the whole point of this file:
 *
 *   Nimiq Pay   owns the wallet, the native approval and the signing. We hand
 *               it a recipient, a Luna amount and a data string, and it hands
 *               back a transaction hash.
 *               https://nimiq.dev/mini-apps/api-reference/nimiq-provider
 *   Backend     owns the money. It issues the terms, verifies the transaction
 *               on-chain and creates the pass. `domain.Purchase` has no path to
 *               CONFIRMED that does not go through verified evidence.
 *   Frontend    orchestrates the two and renders the truth it is told.
 *
 * The awkward cases are the important ones:
 *  - user rejection → CANCELLED, not an error (official FAQ; docs/05 §57)
 *  - anything unknown after submission → UNCERTAIN, never FAILED (§62), because
 *    a false failure is what makes people pay twice
 *  - once a transaction may exist, no retry is offered (§55)
 */

/** How long verification may run before we tell the user it's taking a while. */
const VERIFICATION_DELAY_NOTICE_MS = 15_000
/** Upper bound on polling one purchase, after which we stop claiming progress. */
const VERIFICATION_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 2_500

export interface PurchaseFlow {
  state: PaymentState
  start: () => Promise<void>
  reset: () => void
  /** Resumes watching a purchase after a refresh or a return from Nimiq Pay. */
  resume: (purchaseId: string) => Promise<void>
  /** True while a wallet or network step is in flight. */
  busy: boolean
  /**
   * The purchase this attempt is following, as soon as one exists. The page
   * puts it in the URL so a refresh can resume instead of starting again.
   */
  purchaseId: string | null
}

export function usePurchaseFlow(packageId: string | undefined): PurchaseFlow {
  const [state, setState] = useState<PaymentState>({ kind: 'IDLE' })
  const queryClient = useQueryClient()

  const mounted = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guards re-entry into `start`. The button is already disabled outside the
  // startable states, but a hook this consequential should not depend on a
  // caller rendering the right thing.
  const starting = useRef(false)
  /**
   * Set once the wallet has returned a transaction hash for this attempt.
   *
   * It is the reason the flow can never fall back to a pre-payment state: after
   * a broadcast, a purchase the backend still reports as CREATED means the
   * submission never reached it, not that nothing was sent. Rendering
   * "Ready to pay" there would invite a second payment for a transaction that
   * already exists (docs/05 §55, §62).
   */
  const broadcast = useRef(false)

  /**
   * One idempotency identity per attempt, scoped per operation.
   *
   * A double click reuses the same key, so the backend dedupes instead of
   * creating a second intent (docs/05 §68). The per-operation suffix matters
   * because intent creation, submission reporting and reconciliation are three
   * different writes: sharing one key across them would let a backend that
   * dedupes on the key alone answer the second call with the first call's
   * stored response.
   */
  const attemptId = useRef<string>(createIdempotencyKey())
  const keyFor = useCallback(
    (operation: 'intent' | 'submission' | 'reconcile') => `${attemptId.current}:${operation}`,
    [],
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abortRef.current?.abort()
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [])

  const safeSet = useCallback((next: PaymentState) => {
    if (mounted.current) setState(next)
  }, [])

  /** Cancels any in-flight request and any scheduled poll from a prior attempt. */
  const cancelPending = useCallback(() => {
    abortRef.current?.abort()
    if (pollTimer.current) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const pollUntilSettled = useCallback(
    async (purchase: Purchase) => {
      const startedAt = Date.now()
      const signal = abortRef.current?.signal

      const tick = async () => {
        if (!mounted.current) return

        let latest: Purchase
        try {
          latest = await purchasesApi.getPurchase(purchase.purchaseIntentId, signal)
        } catch (error) {
          if (error instanceof ApiError && error.isAborted) return
          // We cannot see the purchase, but a transaction may be out there.
          // Uncertain is the only honest answer (docs/05 §62).
          safeSet({ kind: 'UNCERTAIN', purchase })
          return
        }

        const mapped = advanceOnly(paymentStateFromPurchase(latest), broadcast.current)

        if (mapped.kind === 'COMPLETE') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.passes.all })
          safeSet(mapped)
          return
        }

        if (mapped.kind === 'FAILED' || mapped.kind === 'CANCELLED') {
          safeSet(mapped)
          return
        }

        const elapsed = Date.now() - startedAt
        if (elapsed > VERIFICATION_TIMEOUT_MS) {
          // Ask the backend to re-check the chain once before giving up on a
          // definite answer (`Purchase.ReconcileVerified`).
          try {
            const reconciled = await purchasesApi.reconcilePurchase(latest.purchaseIntentId, {
              idempotencyKey: keyFor('reconcile'),
              signal,
            })
            const after = advanceOnly(paymentStateFromPurchase(reconciled), broadcast.current)
            safeSet(after.kind === 'COMPLETE' ? after : { kind: 'UNCERTAIN', purchase: reconciled })
          } catch {
            safeSet({ kind: 'UNCERTAIN', purchase: latest })
          }
          return
        }

        safeSet(
          mapped.kind === 'VERIFYING' && elapsed > VERIFICATION_DELAY_NOTICE_MS
            ? { kind: 'VERIFICATION_DELAYED', purchase: latest }
            : mapped,
        )

        pollTimer.current = setTimeout(() => void tick(), POLL_INTERVAL_MS)
      }

      await tick()
    },
    [keyFor, queryClient, safeSet],
  )

  /** One purchase attempt, from intent to settled. */
  const runAttempt = useCallback(
    async (pkgId: string) => {
    cancelPending()
    const controller = new AbortController()
    abortRef.current = controller
    broadcast.current = false

    safeSet({ kind: 'CREATING_INTENT' })

    // 1. Intent. Price, recipient, reference and network all come from the
    //    backend; the displayed price is never used as the amount (docs/08 §71).
    let purchase: Purchase
    try {
      purchase = await purchasesApi.createPurchaseIntent(
        { packageId: pkgId },
        { idempotencyKey: keyFor('intent'), signal: controller.signal },
      )
    } catch (error) {
      if (error instanceof ApiError && error.isAborted) return
      safeSet({
        kind: 'FAILED',
        purchase: null,
        reason:
          error instanceof ApiError && error.isNetworkError
            ? 'NETWORK_BEFORE_SUBMIT'
            : 'REJECTED_BY_BACKEND',
      })
      return
    }

    // The payment instruction is server-authored and only present while the
    // intent is still awaiting payment. Its absence means this purchase is past
    // that point — recovered mid-flight, already submitted, cancelled — and
    // paying again would be exactly the duplicate the contract exists to stop.
    const request = purchase.paymentRequest
    if (!request) {
      safeSet(advanceOnly(paymentStateFromPurchase(purchase), true))
      return
    }

    // A testnet intent must never be paid from a mainnet build, or vice versa
    // (docs/04 §49). Nimiq Pay has its own network switch, so this only catches
    // a misconfigured build talking to a backend on the other network.
    if (request.network !== NIMIQ_NETWORK) {
      safeSet({ kind: 'FAILED', purchase, reason: 'REJECTED_BY_BACKEND' })
      return
    }

    // 2. Read-only pre-flight. Neither call opens a dialog, so this costs the
    //    user nothing and avoids asking them to approve a payment the wallet
    //    cannot reliably broadcast.
    const readiness = await getNetworkReadiness()
    if (!readiness.consensusEstablished) {
      safeSet({ kind: 'FAILED', purchase, reason: 'NO_CONSENSUS' })
      return
    }

    // 3. Wallet. Nimiq Pay owns the approval sheet from here.
    safeSet({ kind: 'AWAITING_WALLET', purchase })

    let transactionHash: string
    try {
      // Straight from `paymentRequest`, unmodified. `valueLuna` maps to the
      // SDK's `value`, and `data` is passed through verbatim — the spec says
      // not to regenerate it, because the backend matches the on-chain
      // transaction against exactly this string.
      transactionHash = await sendBasicTransactionWithData({
        recipient: request.recipient,
        value: request.valueLuna,
        data: request.data,
      })
    } catch (error) {
      if (error instanceof NimiqOperationError) {
        if (error.isUserRejection) {
          safeSet({ kind: 'CANCELLED', purchase })
          return
        }
        safeSet({ kind: 'FAILED', purchase, reason: failureReasonFor(error.kind) })
        return
      }
      // Unclassifiable failure around the wallet call: we cannot prove nothing
      // was sent, so we do not claim failure.
      safeSet({ kind: 'UNCERTAIN', purchase })
      return
    }

    // 4. Report the hash so the backend can look the transaction up.
    //    From here the money may have moved, whatever the backend says next.
    broadcast.current = true
    safeSet({ kind: 'TRANSACTION_SUBMITTED', purchase, transactionHash })

    let submitted = purchase
    try {
      submitted = await purchasesApi.submitTransaction(
        purchase.purchaseIntentId,
        { txHash: transactionHash },
        { signal: controller.signal },
      )
    } catch (error) {
      if (error instanceof ApiError && error.isAborted) return
      // The transaction was submitted but we could not tell the backend.
      // Keep polling rather than declaring anything.
      safeSet({ kind: 'UNCERTAIN', purchase })
    }

    // 5. Wait for the backend's verdict.
    await pollUntilSettled(submitted)
    },
    [cancelPending, keyFor, pollUntilSettled, safeSet],
  )

  const start = useCallback(async () => {
    if (!packageId) return
    // Re-entry guard: two overlapping attempts would race for the same wallet
    // and leave the later one writing over the earlier one's state. The button
    // is disabled outside the startable states, but a hook this consequential
    // should not depend on a caller rendering the right thing.
    if (starting.current) return
    starting.current = true
    try {
      await runAttempt(packageId)
    } finally {
      starting.current = false
    }
  }, [packageId, runAttempt])

  /**
   * Picks a purchase back up by id — after a refresh, a back navigation, or the
   * trip out to Nimiq Pay and back (docs/05 §66).
   */
  const resume = useCallback(
    async (purchaseId: string) => {
      cancelPending()
      const controller = new AbortController()
      abortRef.current = controller
      // A resumed purchase is one we already walked away from, so treat it as
      // possibly paid until the backend says otherwise.
      broadcast.current = true

      try {
        const purchase = await purchasesApi.getPurchase(purchaseId, controller.signal)
        safeSet(advanceOnly(paymentStateFromPurchase(purchase), true))
        await pollUntilSettled(purchase)
      } catch (error) {
        if (error instanceof ApiError && error.isAborted) return
        // A purchase the backend has never heard of is not an uncertain
        // payment — it is a stale or wrong id, and telling the customer "we
        // can't confirm your payment" would be alarming and false. Anything
        // else (offline, 5xx) genuinely is uncertain (docs/05 §62).
        if (error instanceof ApiError && error.status === 404) {
          broadcast.current = false
          safeSet({ kind: 'IDLE' })
          return
        }
        safeSet({ kind: 'UNCERTAIN', purchase: null })
      }
    },
    [cancelPending, pollUntilSettled, safeSet],
  )

  const reset = useCallback(() => {
    cancelPending()
    attemptId.current = createIdempotencyKey()
    broadcast.current = false
    safeSet({ kind: 'IDLE' })
  }, [cancelPending, safeSet])

  const busy =
    state.kind === 'CREATING_INTENT' ||
    state.kind === 'AWAITING_WALLET' ||
    state.kind === 'TRANSACTION_SUBMITTED' ||
    state.kind === 'VERIFYING' ||
    state.kind === 'VERIFICATION_DELAYED' ||
    state.kind === 'PENDING' ||
    state.kind === 'CONFIRMED' ||
    state.kind === 'PASS_CREATING'

  return { state, start, reset, resume, busy, purchaseId: purchaseIdOf(state) }
}

/** USER_REJECTED is handled before this point; it is a cancellation. */
function failureReasonFor(kind: NimiqErrorKind): PaymentFailureReason {
  return kind === 'USER_REJECTED' ? 'UNKNOWN' : WALLET_ERROR_TO_FAILURE_REASON[kind]
}

function purchaseIdOf(state: PaymentState): string | null {
  return 'purchase' in state ? (state.purchase?.purchaseIntentId ?? null) : null
}

/**
 * Stops a backend status from walking the UI backwards past a broadcast.
 *
 * `paymentStateFromPurchase` maps CREATED/PAYMENT_PENDING to `INTENT_CREATED`,
 * which renders "Ready to pay" with an armed Buy button. That is correct before
 * a transaction exists and dangerous after one: if the wallet broadcast but the
 * submission report never landed, the backend still reports CREATED, and the
 * customer would be invited to pay a second time for a transaction already on
 * its way (docs/05 §55, §61-§62).
 *
 * Once `broadcast` is set, any pre-payment state is reported as UNCERTAIN
 * instead — the honest answer, and one that offers no retry.
 */
function advanceOnly(mapped: PaymentState, broadcast: boolean): PaymentState {
  if (!broadcast) return mapped
  if (mapped.kind === 'INTENT_CREATED' || mapped.kind === 'CREATING_INTENT') {
    return { kind: 'UNCERTAIN', purchase: 'purchase' in mapped ? mapped.purchase : null }
  }
  return mapped
}
