import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, purchasesApi, queryKeys } from '@/api'
import { NIMIQ_NETWORK, NimiqOperationError, currentTransport } from '@/lib/nimiq'
import { requireBackendNetwork } from '@/api/runtime'
import { useSession } from '@/hooks/use-session'
import { walletAttemptId } from '@/lib/nimiq/purchase-handoff'
import { useRevalidateOnForeground } from '@/hooks/use-foreground'
import { createIdempotencyKey } from '@/lib/utils'
import type { Purchase } from '@/types/domain'
import type { PaymentState } from '@/types/payment'
import {
  isSettlingPaymentState,
  isTerminalPaymentState,
  mayRetryPayment,
  paymentStateFromPurchase,
  WALLET_ERROR_TO_FAILURE_REASON,
} from '@/types/payment'

/**
 * Drives one purchase attempt.
 *
 * The backend owns payment terms, customer identity and settlement. Desktop
 * displays an authenticated purchase locator; only the native Mini App sends
 * the backend instruction after explicit approval. Both watch the same record.
 * https://nimiq.dev/mini-apps/api-reference/nimiq-provider
 *
 * The awkward cases are the important ones:
 *  - user rejection → CANCELLED, not an error (official FAQ; docs/05 §57)
 *  - anything unknown after submission → UNCERTAIN, never FAILED (§62), because
 *    a false failure is what makes people pay twice
 *  - once a transaction may exist, no retry is offered (§55)
 *  - a wallet window that opened and closed is not evidence of anything: only
 *    the backend's verdict on the hash is (§34)
 */

/** How long verification may run before we tell the user it's taking a while. */
const VERIFICATION_DELAY_NOTICE_MS = 15_000
/** Upper bound on polling one purchase, after which we stop claiming progress. */
const VERIFICATION_TIMEOUT_MS = 120_000
/**
 * First gap between polls.
 *
 * Sized against what the backend can now actually have done by then. Under the
 * `inclusion` policy a purchase settles on a validated canonical micro block —
 * about a second of chain time plus one reconciler tick — so the answer to the
 * first poll is frequently already "completed". At 2.5s that answer sat
 * unasked for most of the time the customer was waiting; the settlement itself
 * had stopped being the slow part.
 *
 * Not lower than this on purpose. Below roughly a second the loop is asking
 * faster than a block can appear, which cannot make anything arrive sooner and
 * multiplies request volume across every open checkout.
 */
const POLL_INTERVAL_MS = 1_500
/**
 * Ceiling for the backoff while the backend is settling.
 *
 * It was fifteen seconds, chosen when the backend's own re-check floor for a
 * candidate transaction was thirty. Both were wrong in the same direction and
 * they compounded: the server would not look again for thirty seconds, and
 * when it finally did and confirmed, this screen could still be up to fifteen
 * seconds from asking. A payment final on chain in a few seconds could take
 * the better part of a minute to appear, and the spinner in between was the
 * whole of what the customer saw.
 *
 * The server floor is now two seconds (`database.Due`) and settlement no
 * longer waits for a macro block (ADR-021), so the states this ceiling governs
 * are short-lived: the backoff exists for the unusual purchase — a resyncing
 * node, a `finality`-policy deployment — rather than the normal one. Four
 * seconds keeps those cases current without turning a slow settlement into a
 * request storm.
 */
const POLL_INTERVAL_MAX_MS = 4_000
/**
 * The gap while the customer is still paying, which does not widen.
 *
 * On the desktop QR checkout this is the number that decides how long a
 * screen keeps saying "Waiting for payment" after the phone has already paid.
 * The backend notices the transaction within a couple of seconds; if this
 * loop has meanwhile backed off to fifteen, the customer watches a stale
 * screen for the difference and starts wondering whether it worked.
 *
 * It is bounded work: this state only lasts as long as somebody is actively
 * standing in front of a QR code, and it ends the moment the backend reports
 * anything else.
 */
const AWAITING_PAYMENT_INTERVAL_MS = 3_000

/**
 * Poll gaps widen as waiting goes on — except while waiting for the payment
 * itself.
 *
 * The backend runs its own background reconciler, so this loop exists to keep
 * *this screen* current, not to drive settlement. Once a transaction is being
 * verified, asking more often cannot make a block arrive sooner, so the gap
 * widens — but it widens from a smaller start and to a lower ceiling than it
 * used to, because settlement no longer waits out a macro block and the answer
 * is usually a poll or two away rather than twenty (ADR-021).
 *
 * Before that, though, the question being asked is "has it been paid yet?",
 * and the answer changes the instant it does. That one stays fast.
 */
function pollDelay(attempt: number, awaitingPayment: boolean): number {
  if (awaitingPayment) return AWAITING_PAYMENT_INTERVAL_MS
  return Math.min(POLL_INTERVAL_MS * 1.5 ** attempt, POLL_INTERVAL_MAX_MS)
}

export interface PurchaseFlow {
  state: PaymentState
  start: () => Promise<void>
  pay: () => Promise<void>
  error: string | null
  reset: () => void
  /** Resumes watching a purchase after a refresh or a return from Nimiq Pay. */
  resume: (purchaseId: string) => Promise<void>
  /**
   * Asks the backend to re-check the chain, once, on the customer's command.
   *
   * The manual half of reconciliation (§20). Available where waiting is the
   * only other option — uncertain, or awaiting finality — and safe to press
   * repeatedly: reconciling never authorises a payment, it only re-reads
   * evidence that already exists.
   */
  reconcile: () => Promise<void>
  /** True while a manual reconcile is in flight. */
  reconciling: boolean
  /**
   * Abandons an intent the customer decided not to pay.
   *
   * `POST /purchases/{id}/cancel` accepts only an unpaid, unsubmitted intent
   * and answers 409 for anything else — which is the whole safety property: a
   * payment can never be "cancelled" here, only an intention to make one. A
   * 409 is therefore treated as the backend knowing better than the screen
   * does, and the purchase is re-read rather than argued with.
   */
  cancel: () => Promise<void>
  /** True while a cancellation is in flight. */
  cancelling: boolean
  /** Whether abandoning the current intent is offered at all. */
  mayCancel: boolean
  /**
   * Hands the backend a transaction hash the customer has in front of them.
   *
   * The recovery path for a payment nobody could report automatically. When a
   * purchase is paid by scanning the code in Nimiq Pay, the phone that paid is
   * not the device holding the intent, so no client is in a position to call
   * `POST /purchases/{id}/transactions` — the backend has to find the payment
   * by sweeping the provider's address, and that needs an address-indexing
   * node and an exact sender match. When either is missing the money is on
   * chain and the purchase sits at "awaiting payment" with no way out
   * (docs/NIMIQ-PAYMENT-QR-INVESTIGATION-2026-09-16.md §4).
   *
   * This is the way out, and it grants nothing: a hash is a nomination, not
   * evidence. It goes through the same verification as any other — sender,
   * recipient, exact value, network, execution, inclusion, finality, and
   * global uniqueness — so a hash belonging to somebody else's transaction
   * settles nothing (docs/09-SECURITY.md §96).
   */
  reportTransaction: (hash: string) => Promise<void>
  /** True while a reported hash is being submitted. */
  reporting: boolean
  /** Whether reporting a hash could still help this purchase. */
  mayReportTransaction: boolean
  /** True while a wallet or network step is in flight. */
  busy: boolean
  /**
   * The purchase this attempt is following, as soon as one exists. The page
   * puts it in the URL so a refresh can resume instead of starting again.
   */
  purchaseId: string | null
}

export function usePurchaseFlow(passId: string | undefined, existingId?: string): PurchaseFlow {
  const [state, setState] = useState<PaymentState>({ kind: 'IDLE' })
  const queryClient = useQueryClient()
  const { session } = useSession()
  const intentRef = useRef<Purchase | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guards re-entry into `start`. The button is already disabled outside the
  // startable states, but a hook this consequential should not depend on a
  // caller rendering the right thing.
  const starting = useRef(false)
  const reconciling = useRef(false)
  const [isReconciling, setReconciling] = useState(false)
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

      let attempt = 0

      const tick = async () => {
        if (!mounted.current || signal?.aborted) return

        let latest: Purchase
        try {
          latest = await purchasesApi.getPurchase(purchase.purchaseIntentId, signal)
        } catch (error) {
          if (error instanceof ApiError && error.isAborted) return
          // A settled POST/GET result must not be rewritten just because a later
          // poll cannot re-read it. Compensation and complete are finished.
          const already = paymentStateFromPurchase(purchase)
          if (isTerminalPaymentState(already)) {
            safeSet(already)
            return
          }
          // We cannot see the purchase, but a transaction may be out there.
          // Uncertain is the only honest answer (docs/05 §62).
          safeSet({ kind: 'UNCERTAIN', purchase })
          return
        }

        if (signal?.aborted) return
        intentRef.current = latest
        const mapped = advanceOnly(paymentStateFromPurchase(latest), broadcast.current)

        if (mapped.kind === 'COMPLETE') {
          // Both caches: the pass list is assembled from the purchase list, so
          // invalidating only the passes would rebuild them from a stale set of
          // purchases and miss the one just created.
          void queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all })
          void queryClient.invalidateQueries({ queryKey: queryKeys.passes.all })
          safeSet(mapped)
          return
        }

        // Every state the backend has finished deciding stops the loop.
        //
        // COMPENSATION_REQUIRED belongs here for a reason that is easy to miss:
        // it is not a state the backend moves on from, so polling past it would
        // do nothing for two minutes and then hit the timeout below — which
        // rewrites the state as UNCERTAIN. That would take a verified payment
        // the backend explained precisely and turn it into "we can't tell",
        // losing both the receipt and the do-not-pay-again guarantee (§2, §38).
        if (isTerminalPaymentState(mapped)) {
          // A compensation case belongs in the customer's purchase list from
          // the moment it exists, so refresh it here too (§29).
          if (mapped.kind === 'COMPENSATION_REQUIRED') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all })
          }
          safeSet(mapped)
          return
        }

        const elapsed = Date.now() - startedAt
        if (elapsed > VERIFICATION_TIMEOUT_MS && mapped.kind !== 'INTENT_CREATED') {
          // Ask the backend to re-check the chain once before giving up on a
          // definite answer (`Purchase.ReconcileVerified`).
          try {
            const reconciled = await purchasesApi.reconcilePurchase(latest.purchaseIntentId, {
              idempotencyKey: keyFor('reconcile'),
              signal,
            })
            const after = advanceOnly(paymentStateFromPurchase(reconciled), broadcast.current)
            // Only fall back to UNCERTAIN when the re-check produced no verdict.
            // A reconcile that answers COMPENSATION_REQUIRED — or any other
            // settled outcome — is the definite answer we were waiting for, and
            // overwriting it with "we can't tell" would discard it.
            safeSet(isTerminalPaymentState(after) ? after : { kind: 'UNCERTAIN', purchase: reconciled })
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

        // INTENT_CREATED is "the QR is up and nobody has paid yet". Every
        // other state is the backend working, where the backoff applies.
        pollTimer.current = setTimeout(
          () => void tick(),
          pollDelay(attempt++, mapped.kind === 'INTENT_CREATED'),
        )
      }

      await tick()
    },
    [keyFor, queryClient, safeSet],
  )

  // Both runtimes first show the server's intent. Only the Mini App can
  // dispatch payment, after a separate, explicit review/approval action.
  const start = useCallback(async () => {
    if (!session || starting.current || (!passId && !existingId)) return
    starting.current = true
    setError(null)
    cancelPending()
    abortRef.current = new AbortController()
    safeSet({ kind: 'CREATING_INTENT' })
    try {
      await requireBackendNetwork()
      const id = existingId ?? intentRef.current?.purchaseIntentId
      let purchase = id
        ? await purchasesApi.getPurchase(id, abortRef.current.signal)
        : await purchasesApi.createPurchaseIntent({ passId: passId! }, { idempotencyKey: keyFor('intent'), signal: abortRef.current.signal })
      if (!existingId && isSpentIntent(purchase)) {
        attemptId.current = createIdempotencyKey()
        purchase = await purchasesApi.createPurchaseIntent({ passId: passId! }, { idempotencyKey: keyFor('intent') })
      }
      intentRef.current = purchase
      const mapped = paymentStateFromPurchase(purchase)
      safeSet(mapped)
      // The desktop must observe a phone paying this same intent, including
      // while the purchase is still awaiting its first transaction hash.
      if (mapped.kind === 'INTENT_CREATED') {
        pollTimer.current = setTimeout(() => void pollUntilSettled(purchase), POLL_INTERVAL_MS)
      } else if (isSettlingPaymentState(mapped) || mapped.kind === 'UNCERTAIN') {
        await pollUntilSettled(purchase)
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PASS_PURCHASE_CUTOFF') {
        safeSet({ kind: 'PURCHASE_CUTOFF', purchase: null })
        return
      }
      // The provider pressed Buy on their own pass. The button is normally
      // replaced before this can happen, but the backend is the rule and this
      // is what it says — so report it as what it is rather than as a payment
      // failure.
      if (err instanceof ApiError && err.code === 'SELF_PURCHASE_NOT_ALLOWED') {
        safeSet({ kind: 'SELF_PURCHASE', purchase: null })
        return
      }
      // A pass for this is already on their shelf. Also not a payment failure:
      // no intent was created, nothing was charged, and the answer will not
      // change until the pass they hold is finished.
      if (err instanceof ApiError && err.code === 'PASS_ALREADY_OWNED') {
        safeSet({ kind: 'ALREADY_OWNED', purchase: null })
        return
      }
      // Their last attempt at this pass can still be paid. Nothing was
      // charged *by this request*, but something may have been charged by the
      // previous one — which is exactly why no retry is offered here.
      if (err instanceof ApiError && err.code === 'PURCHASE_IN_SETTLEMENT') {
        safeSet({ kind: 'PURCHASE_IN_SETTLEMENT', purchase: null })
        return
      }
      setError(err instanceof Error ? err.message : 'Could not prepare this purchase.')
      if (err instanceof ApiError && err.isNetworkError) {
        safeSet({ kind: 'FAILED', purchase: null, reason: 'NETWORK_BEFORE_SUBMIT' })
        return
      }
      safeSet({ kind: 'FAILED', purchase: null, reason: 'REJECTED_BY_BACKEND' })
    } finally { starting.current = false }
  }, [session, passId, existingId, cancelPending, safeSet, keyFor, pollUntilSettled])

  const pay = useCallback(async () => {
    const original = intentRef.current
    const transport = currentTransport()
    if (!original || !session || starting.current || transport?.kind !== 'mini-app') return
    starting.current = true
    setError(null)
    cancelPending()
    abortRef.current = new AbortController()
    let dispatch: string | null = null
    let purchase = original
    const receiptKey = `nimpass:payment:${session.identity.wallet}:${original.purchaseIntentId}`
    try {
      await requireBackendNetwork()
      // The intent this attempt already holds, not a fresh read of it.
      //
      // There used to be a `GET /purchases/{id}` here, before anything else
      // happened — a whole sequential round trip between the customer pressing
      // Approve and the screen doing anything at all, on the one path where
      // they are already waiting on a wallet. It bought nothing: this record is
      // kept current by the poll loop while the intent is payable, and the
      // checks below are re-applied against the *authoritative* record that
      // `beginWalletAttempt` returns, which is the one that matters because it
      // is read under the same lock that grants the dispatch.
      const request = purchase.paymentRequest
      if (!request) { safeSet(paymentStateFromPurchase(purchase)); return }
      if (!sameWallet(purchase.customerWallet, session.identity.wallet)) {
        throw new Error('This purchase belongs to another wallet. Log in with the wallet used on desktop.')
      }
      if (request.network !== NIMIQ_NETWORK) throw new Error('Network mismatch. Open the matching Nimpass deployment.')
      if (Date.parse(request.expiresAt) <= Date.now()) throw new Error('This purchase intent expired. No payment was requested.')
      const readiness = await transport.networkReadiness()
      if (readiness && !readiness.consensusEstablished) throw new Error('Nimiq Pay is not synced. Wait for consensus before paying.')
      // Persist the possible-broadcast state server-side BEFORE calling the
      // wallet. A second phone/reload cannot obtain a second dispatch.
      //
      // `dispatch` is set *before* the call and stays set if the call's
      // response is lost: a request that was sent and not answered may have
      // been committed, so the lock may be ours and the flow must stay
      // uncertain. The catch block below distinguishes that from a refusal the
      // backend actually *answered* — see `refusedBeforeDispatch`.
      //
      // The backend re-checks every condition checked above under the row lock
      // that grants the dispatch (`BeginWalletAttempt`: PAYMENT_PENDING, not
      // expired, no candidate hash, no attempt already granted), which is why
      // the client no longer re-reads the purchase first.
      dispatch = walletAttemptId()
      purchase = await purchasesApi.beginWalletAttempt(purchase.purchaseIntentId, dispatch)
      // Everything checked above, re-checked here against the record the
      // backend just returned. This is strictly stronger than the read that was
      // removed: that one happened before the lock and could go stale in the
      // gap; this one cannot, because the lock and this record come from the
      // same transaction. An expired or no-longer-payable intent has no
      // `paymentRequest` at all (`purchaseDTO`), which is what the first clause
      // catches.
      const instruction = purchase.paymentRequest
      if (!instruction || instruction.network !== NIMIQ_NETWORK) throw new Error('The payment instruction is no longer available.')
      if (!sameWallet(purchase.customerWallet, session.identity.wallet)) {
        throw new Error('This purchase belongs to another wallet. Log in with the wallet used on desktop.')
      }
      broadcast.current = true
      safeSet({ kind: 'AWAITING_WALLET', purchase })
      const hash = await transport.pay(Promise.resolve({ recipient: instruction.recipient, valueLuna: instruction.valueLuna, data: instruction.data, sender: purchase.customerWallet }))
      // A public hash is only a recovery hint. Backend lookup is still authority.
      try { localStorage.setItem(receiptKey, hash) } catch { /* Server lock still prevents a second payment. */ }
      safeSet({ kind: 'TRANSACTION_SUBMITTED', purchase, transactionHash: hash })
      const submitted = await purchasesApi.submitTransaction(purchase.purchaseIntentId, { txHash: hash })
      try { localStorage.removeItem(receiptKey) } catch { /* Re-submitting the same hash is idempotent. */ }
      await pollUntilSettled(submitted)
    } catch (err) {
      // A dispatch the backend refused *in a reply*. It answered, so it never
      // granted the lock and the wallet was never asked: nothing was
      // broadcast, and reporting an uncertain payment here would tell a
      // customer their money might have moved when it demonstrably could not
      // have. A lost response is the opposite case and keeps `dispatch`.
      if (refusedBeforeDispatch(err, broadcast.current)) {
        setError(err.message)
        safeSet(
          err.code === 'INTENT_EXPIRED'
            ? { kind: 'FAILED', purchase, reason: 'INTENT_EXPIRED' }
            : paymentStateFromPurchase(purchase),
        )
        return
      }
      if (dispatch) {
        // Only definite wallet rejection can unlock. Timeouts/network errors
        // after dispatch are ambiguous even if the provider returned no hash.
        if (err instanceof NimiqOperationError && ['USER_REJECTED', 'INSUFFICIENT_FUNDS', 'INVALID_TRANSACTION', 'WALLET_BUSY'].includes(err.kind)) {
          try {
            await purchasesApi.releaseWalletAttempt(purchase.purchaseIntentId, dispatch)
            broadcast.current = false
            if (err.kind === 'USER_REJECTED') {
              safeSet({ kind: 'CANCELLED', purchase })
            } else {
              safeSet({
                kind: 'FAILED',
                purchase,
                reason: WALLET_ERROR_TO_FAILURE_REASON[err.kind],
              })
            }
            return
          } catch { /* Unknown release outcome: remain locked. */ }
        }
        if (err instanceof ApiError && err.code === 'PAYMENT_CONFLICT') {
          safeSet({ kind: 'FAILED', purchase, reason: 'PAYMENT_CONFLICT' })
          return
        }
        safeSet({ kind: 'UNCERTAIN', purchase })
      } else {
        safeSet(paymentStateFromPurchase(purchase))
      }
      setError(err instanceof Error ? err.message : 'Could not confirm the payment. Do not pay again.')
    } finally { starting.current = false }
  }, [session, cancelPending, safeSet, pollUntilSettled])

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
      broadcast.current = false

      try {
        let purchase = await purchasesApi.getPurchase(purchaseId, controller.signal)
        intentRef.current = purchase
        const receiptKey = `nimpass:payment:${purchase.customerWallet}:${purchaseId}`
        let hash: string | null = null
        try { hash = localStorage.getItem(receiptKey) } catch { /* Recovery still polls the server lock. */ }
        if (hash && /^[0-9a-f]{64}$/i.test(hash)) {
          broadcast.current = true
          try {
            purchase = await purchasesApi.submitTransaction(purchaseId, { txHash: hash })
            try { localStorage.removeItem(receiptKey) } catch { /* Safe to repeat submission. */ }
          } catch (submitError) {
            if (submitError instanceof ApiError && submitError.isAborted) return
            // The GET succeeded; a stored hash means a transaction may exist.
            // A failed report is uncertain, never "this purchase was never here".
            const mapped = advanceOnly(paymentStateFromPurchase(purchase), true)
            safeSet(mapped.kind === 'INTENT_CREATED' ? { kind: 'UNCERTAIN', purchase } : mapped)
            await pollUntilSettled(purchase)
            return
          }
        }
        const mapped = advanceOnly(paymentStateFromPurchase(purchase), broadcast.current)
        safeSet(mapped)
        if (isSettlingPaymentState(mapped) || mapped.kind === 'UNCERTAIN') {
          await pollUntilSettled(purchase)
        }
      } catch (error) {
        if (error instanceof ApiError && error.isAborted) return
        // A purchase the backend has never heard of is not an uncertain
        // payment — it is a stale or wrong id, and telling the customer "we
        // can't confirm your payment" would be alarming and false. Anything
        // else (offline, 5xx) genuinely is uncertain (docs/05 §62).
        // 404 and FORBIDDEN mean the same thing to a customer: this purchase is
        // not theirs to see. Object-level authorisation is decided server-side
        // and the frontend only normalises the answer — it never assumes an id
        // it holds grants access to the record behind it (§30).
        if (error instanceof ApiError && (error.status === 404 || error.code === 'FORBIDDEN')) {
          broadcast.current = false
          setError('This purchase is unavailable for this wallet. Log in with the same wallet used on desktop.')
          safeSet({ kind: 'IDLE' })
          return
        }
        safeSet({ kind: 'UNCERTAIN', purchase: null })
      }
    },
    [cancelPending, pollUntilSettled, safeSet],
  )

  /**
   * The customer-initiated re-check (§20).
   *
   * Deliberately thin: it asks the backend to look again and renders whatever
   * comes back. It cannot advance a purchase on its own, and it never creates
   * an intent or a transaction, so the worst a frantic tapping produces is a
   * few extra reads.
   *
   * `advanceOnly` still applies — a reconcile that answers with a pre-payment
   * state after a broadcast is reported as uncertain, not as "ready to pay".
   */
  const reconcile = useCallback(async () => {
    const id = purchaseIdOf(state)
    if (!id || reconciling.current) return
    reconciling.current = true
    setReconciling(true)
    try {
      const latest = await purchasesApi.reconcilePurchase(id, {
        idempotencyKey: keyFor('reconcile'),
      })
      safeSet(advanceOnly(paymentStateFromPurchase(latest), broadcast.current))
    } catch (error) {
      // A re-check that fails tells us nothing new, so it must not downgrade a
      // state the backend already settled. Only an in-flight wait becomes
      // uncertain; a compensation case or a completed purchase stays put.
      if (error instanceof ApiError && error.isAborted) return
      if (!isTerminalPaymentState(state)) {
        safeSet({ kind: 'UNCERTAIN', purchase: 'purchase' in state ? state.purchase : null })
      }
    } finally {
      reconciling.current = false
      if (mounted.current) setReconciling(false)
    }
  }, [keyFor, safeSet, state])

  const reset = useCallback(() => {
    cancelPending()
    attemptId.current = createIdempotencyKey()
    intentRef.current = null
    broadcast.current = false
    safeSet({ kind: 'IDLE' })
  }, [cancelPending, safeSet])

  const [cancelling, setCancelling] = useState(false)
  const [reporting, setReporting] = useState(false)

  /**
   * Submits a hash the customer copied out of their wallet.
   *
   * Normalised before it is sent — trimmed, `0x` removed, lower-cased —
   * because a hash pasted from a block explorer or a wallet's share sheet
   * routinely arrives with one of those, and the backend's shape check is
   * exact. Normalising is not loosening: the value still has to be 64 hex
   * characters, and anything else is refused here rather than turned into a
   * confusing 400.
   *
   * `broadcast` is set before the call. From this point the customer has told
   * us a transaction exists, so the UI must never walk back to "Ready to pay"
   * and invite a second payment (docs/05 §55, §62) — even if the report
   * itself fails.
   */
  const reportTransaction = useCallback(
    async (raw: string) => {
      const id = purchaseIdOf(state)
      if (!id || reporting) return
      const hash = normaliseTransactionHash(raw)
      if (!hash) {
        setError('That does not look like a Nimiq transaction hash. It is 64 characters long.')
        return
      }
      setReporting(true)
      setError(null)
      broadcast.current = true
      try {
        const submitted = await purchasesApi.submitTransaction(id, { txHash: hash })
        intentRef.current = submitted
        safeSet(advanceOnly(paymentStateFromPurchase(submitted), true))
        await pollUntilSettled(submitted)
      } catch (cause) {
        if (cause instanceof ApiError && cause.isAborted) return
        // A conflict means the backend will not bind this hash to this
        // purchase — most often because the hash belongs to a different
        // transaction. That is a definite answer about the *hash*, and it is
        // never evidence that the customer's money stayed put.
        setError(
          cause instanceof ApiError && cause.code === 'PAYMENT_CONFLICT'
            ? 'That transaction does not match this purchase. Check the hash, and do not send another payment.'
            : cause instanceof Error
              ? cause.message
              : 'Could not report that transaction.',
        )
      } finally {
        setReporting(false)
      }
    },
    [pollUntilSettled, reporting, safeSet, state],
  )

  /**
   * Cancels the current intent, if the backend still considers it cancellable.
   *
   * Never offered once anything has been broadcast: `broadcast.current` guards
   * the call even though the UI already hides it, because a hook this
   * consequential should not depend on a caller rendering the right thing.
   */
  const cancel = useCallback(async () => {
    const id = purchaseIdOf(state)
    if (!id || broadcast.current || !nothingWasSent(state)) return

    setCancelling(true)
    try {
      const cancelled = await purchasesApi.cancelPurchase(id)
      safeSet(paymentStateFromPurchase(cancelled))
    } catch (error) {
      if (error instanceof ApiError && error.isAborted) return
      // A 409 means the backend no longer considers this cancellable — most
      // likely because a payment is in flight after all. Re-read rather than
      // insisting: the purchase record is the authority on what happened.
      try {
        const latest = await purchasesApi.getPurchase(id)
        safeSet(advanceOnly(paymentStateFromPurchase(latest), broadcast.current))
      } catch {
        // Leave the state alone; the poll loop and foreground revalidation
        // both still apply.
      }
    } finally {
      setCancelling(false)
    }
  }, [safeSet, state])

  /**
   * Coming back to a settling purchase: re-read it.
   *
   * The poll loop is a `setTimeout` chain, which a backgrounded mobile WebView
   * throttles hard or suspends outright. A customer who approves a payment,
   * locks the phone through macro-block finality and comes back would otherwise
   * find the same spinner the tab froze on — while the purchase has long since
   * confirmed, failed, or become a compensation case.
   *
   * Reconciling is the safe thing to do here: it re-reads evidence and can
   * never authorise a payment, so a revalidation that fires on every foreground
   * cannot cost the customer anything.
   */
  useRevalidateOnForeground(
    useCallback(() => {
      const id = purchaseIdOf(state)
      if (!id) return
      if (!isSettlingPaymentState(state) && state.kind !== 'UNCERTAIN') return
      void purchasesApi
        .getPurchase(id)
        .then((latest) => safeSet(advanceOnly(paymentStateFromPurchase(latest), broadcast.current)))
        .catch(() => {
          // Still unreachable; the poll loop keeps its own counsel.
        })
    }, [safeSet, state]),
    true,
  )

  const busy =
    state.kind === 'CREATING_INTENT' ||
    state.kind === 'AWAITING_WALLET' ||
    state.kind === 'TRANSACTION_SUBMITTED' ||
    state.kind === 'VERIFYING' ||
    state.kind === 'VERIFICATION_DELAYED' ||
    state.kind === 'PENDING' ||
    state.kind === 'CONFIRMED' ||
    state.kind === 'PASS_CREATING'

  return {
    state,
    start,
    pay,
    error,
    reset,
    resume,
    reconcile,
    reconciling: isReconciling,
    cancel,
    cancelling,
    // Derived from the state alone, never from the broadcast ref: a ref read
    // during render is not a reliable input to what gets drawn. The ref is
    // still checked inside `cancel`, where it is an event handler and where it
    // is the last word on whether anything was sent.
    mayCancel: Boolean(purchaseIdOf(state)) && nothingWasSent(state) && !cancelling,
    reportTransaction,
    reporting,
    mayReportTransaction: canReportTransaction(state),
    busy,
    purchaseId: purchaseIdOf(state),
  }
}

/**
 * Whether a failure is the backend refusing to grant the wallet dispatch.
 *
 * Narrow on purpose. It has to be an `ApiError` carrying a real HTTP status —
 * the backend replied — rather than a network error or an abort, where the
 * request may have been committed and the lock may be held. And it only counts
 * before anything was broadcast: after that, no answer to any request can make
 * a transaction stop existing.
 */
function refusedBeforeDispatch(error: unknown, broadcast: boolean): error is ApiError {
  return (
    !broadcast &&
    error instanceof ApiError &&
    !error.isNetworkError &&
    !error.isAborted &&
    error.status !== undefined
  )
}

/**
 * Whether two Nimiq addresses are the same account.
 *
 * Addresses travel in the spaced, upper-case user-facing form in some places
 * and unspaced in others, so they are compared normalised rather than as
 * strings.
 */
function sameWallet(a: string, b: string): boolean {
  return a.replaceAll(' ', '').toUpperCase() === b.replaceAll(' ', '').toUpperCase()
}

/**
 * States in which the frontend *knows* no transaction was broadcast for this
 * attempt: the intent exists and the wallet either was never opened or came
 * back without sending anything.
 *
 * Deliberately the same rule as "a second payment would be safe" — if starting
 * another payment is safe, abandoning this intent is safe too. Everything past
 * the wallet call is excluded, including UNCERTAIN, because there a
 * transaction may exist and nothing here may suggest it can be called off
 * (docs/05-NIMIQ-PAY-INTEGRATION.md §55, §62). The backend re-checks anyway.
 */
function nothingWasSent(state: PaymentState): boolean {
  return state.kind === 'INTENT_CREATED' || mayRetryPayment(state)
}

/**
 * An intent the backend has finished with, which never carried a payment.
 *
 * Every clause is load-bearing. `expired` or `cancelled` is the backend saying
 * this intent is over; a null `transactionHash` is it saying nothing was ever
 * submitted against it; a null `paymentRequest` confirms there is nothing left
 * to pay. Anything less than all three and the safe answer is to leave the
 * purchase alone.
 */
function isSpentIntent(purchase: Purchase): boolean {
  return (
    (purchase.status === 'expired' || purchase.status === 'cancelled') &&
    purchase.transactionHash === null &&
    purchase.paymentRequest === null
  )
}

/**
 * Whether handing the backend a hash could still change this purchase.
 *
 * Every state here is one where a payment may exist on chain that the backend
 * has not been told about:
 *
 *   INTENT_CREATED  the code is on screen and may already have been scanned
 *   UNCERTAIN       something happened and nobody can say what
 *   INTENT_EXPIRED  the intent lapsed while a real payment was in flight
 *
 * Deliberately excludes every settling state: once a hash is being verified,
 * offering to supply one invites the customer to paste a second, unrelated
 * transaction. And it excludes COMPLETE and COMPENSATION_REQUIRED, where the
 * backend has already finished.
 */
function canReportTransaction(state: PaymentState): boolean {
  if (!purchaseIdOf(state)) return false
  if (state.kind === 'INTENT_CREATED' || state.kind === 'UNCERTAIN') return true
  return state.kind === 'FAILED' && state.reason === 'INTENT_EXPIRED'
}

/**
 * The shape a Nimiq transaction hash has to be in before it is worth sending.
 *
 * 32 bytes, lower-case hex, no prefix — the form `getTransactionByHash` takes
 * and the form the backend stores (https://nimiq.dev/rpc/methods). Returns
 * null for anything else rather than sending it and hoping.
 */
function normaliseTransactionHash(raw: string): string | null {
  const value = raw.trim().replace(/^0x/i, '').toLowerCase()
  return /^[0-9a-f]{64}$/.test(value) ? value : null
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
