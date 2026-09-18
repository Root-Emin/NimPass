import type { Compensation, Purchase } from './domain'
import type { NimiqErrorKind } from './wallet'

/**
 * The payment state machine, modelled after the canonical diagram in
 * docs/05-NIMIQ-PAY-INTEGRATION.md §56 plus the interruption paths in §57-§62.
 *
 * This is deliberately a discriminated union rather than an `isLoading`
 * boolean: cancellation, technical failure and *uncertainty* are three
 * different outcomes and the UI must never blur them (§57, §62).
 *
 * None of these states are authoritative on their own. `CONFIRMED`, `COMPLETE`
 * and the pass they reference only ever come from the backend — the frontend
 * may not promote a submitted transaction to a confirmed purchase (§44).
 */
export type PaymentState =
  /** Nothing started. The purchase panel is idle. */
  | { kind: 'IDLE' }
  /** Asking the backend to create a purchase intent. */
  | { kind: 'CREATING_INTENT' }
  /** Intent exists; we know the recipient, exact amount and payment reference. */
  | { kind: 'INTENT_CREATED'; purchase: Purchase }
  /**
   * Nimiq Pay is showing its native payment approval. The user may reject.
   */
  | { kind: 'AWAITING_WALLET'; purchase: Purchase }
  /** The wallet returned a transaction. Nothing is confirmed yet. */
  | { kind: 'TRANSACTION_SUBMITTED'; purchase: Purchase; transactionHash: string | null }
  /** The backend is verifying the transaction against the chain. */
  | { kind: 'VERIFYING'; purchase: Purchase }
  /** Verification is taking longer than expected. Still not a failure. */
  | { kind: 'VERIFICATION_DELAYED'; purchase: Purchase }
  /**
   * The chain has the transaction; the backend is not yet willing to settle on
   * it.
   *
   * Only reachable under `NIMIQ_CONFIRMATION_POLICY=finality`, where the pass
   * waits for the macro block. Under the product's own policy — `inclusion` —
   * a validated canonical inclusion settles immediately and this state is
   * skipped entirely, which is why nothing here says "waiting for finality"
   * any more: most customers will never be in it, and the ones who are are
   * waiting on a deployment's risk setting rather than on anything they did.
   */
  | { kind: 'PENDING'; purchase: Purchase }
  /** Backend accepted the payment. The pass may not exist yet. */
  | { kind: 'CONFIRMED'; purchase: Purchase }
  /** Payment is settled and the backend is provisioning the pass (§54). */
  | { kind: 'PASS_CREATING'; purchase: Purchase }
  /** Terminal success: pass exists. */
  | { kind: 'COMPLETE'; purchase: Purchase; passId: string }
  /**
   * Paid, verified, finalised — and no pass (§3 of this milestone).
   *
   * Not a failure and not an uncertainty: the backend knows exactly what
   * happened. The money arrived, the pass's fixed expiration passed before
   * the pass could be activated, and a compensation case was opened. The
   * customer holds a verified receipt, owes nothing further, and must not pay
   * again. `compensation` carries the backend's own case record; it is nullable
   * because the wire type is, not because its absence weakens any of the above.
   */
  | { kind: 'COMPENSATION_REQUIRED'; purchase: Purchase; compensation: Compensation | null }
  /**
   * The backend refused a *new* intent because the pass is too close to its
   * fixed expiration to settle safely (409 PASS_PURCHASE_CUTOFF).
   *
   * Nothing was charged, so this is not a payment failure — but it is not
   * retryable either, because the same call would be refused again. The cutoff
   * is the backend's decision and is never recomputed here.
   */
  | { kind: 'PURCHASE_CUTOFF'; purchase: null }
  /**
   * The backend refused the intent because this account created the pass
   * (403 SELF_PURCHASE_NOT_ALLOWED).
   *
   * Nothing was charged and nothing can be: the same call will be refused
   * again, because the provider on the pass is this account. Kept as its own
   * state rather than folded into FAILED so the screen can say what is
   * actually true — "this is your pass" — instead of reporting a payment
   * problem to someone who was never going to pay.
   */
  | { kind: 'SELF_PURCHASE'; purchase: null }
  /**
   * The backend refused the intent because this customer is still holding a
   * pass for it (409 PASS_ALREADY_OWNED).
   *
   * Nothing was charged. It is not a payment problem and not a retry — the same
   * call is refused again for as long as the pass has sessions left on it — so
   * it is its own state, and the screen it produces points at the pass they
   * already have rather than at a way to pay for a second one. When that pass
   * is finished, `Buy Again` sells the current terms exactly as documented
   * (docs/01-PRODUCT.md §56).
   */
  | { kind: 'ALREADY_OWNED'; purchase: null }
  /**
   * The backend refused the intent because this customer's previous attempt at
   * the same pass can still be paid (409 PURCHASE_IN_SETTLEMENT).
   *
   * An intent is payable for five minutes longer than it is current, so that a
   * QR payment made in time but noticed late still settles. A second intent
   * inside that window is how one customer pays twice for one pass, so the
   * backend refuses it — and this is the one state where "Try again" would be
   * actively dangerous. The wait is short and clears by itself.
   */
  | { kind: 'PURCHASE_IN_SETTLEMENT'; purchase: null }
  /** The user rejected the wallet dialog. A normal outcome, not an error (§57). */
  | { kind: 'CANCELLED'; purchase: Purchase | null }
  /** Terminal, definite failure. Safe to offer a retry. */
  | { kind: 'FAILED'; purchase: Purchase | null; reason: PaymentFailureReason }
  /**
   * We cannot tell whether a transaction exists (§62). This is safer than
   * claiming failure, because a false failure causes duplicate payments.
   * A retry must never be offered from here.
   */
  | { kind: 'UNCERTAIN'; purchase: Purchase | null }

export type PaymentStateKind = PaymentState['kind']

export type PaymentFailureReason =
  /** Wallet reported the account cannot cover the amount. */
  | 'INSUFFICIENT_FUNDS'
  /** No wallet transport could be reached at all. */
  | 'WALLET_UNAVAILABLE'
  /** The backend rejected the transaction (wrong amount, recipient, reuse…). */
  | 'REJECTED_BY_BACKEND'
  /**
   * The backend refused to bind this hash to this purchase — the amount,
   * recipient or reference did not match, or the transaction already belongs to
   * another purchase (409 PAYMENT_CONFLICT; docs/09-SECURITY.md §96).
   *
   * A definite rejection of the *hash*, never evidence that the money stayed
   * put. Retrying is unsafe, which is why it is in `UNSAFE_TO_RETRY`.
   */
  | 'PAYMENT_CONFLICT'
  /** The purchase intent expired before the transaction landed. */
  | 'INTENT_EXPIRED'
  /** The wallet rejected the transaction shape before broadcasting it. */
  | 'INVALID_TRANSACTION'
  /** The wallet has no network consensus, so a payment would be unreliable. */
  | 'NO_CONSENSUS'
  /** Network problem, definitely before the wallet submitted anything (§60). */
  | 'NETWORK_BEFORE_SUBMIT'
  /** Another wallet approval was already open, so this one never started. */
  | 'WALLET_BUSY'
  /**
   * The browser blocked the wallet window before it could open. Nothing was
   * sent, and the remedy belongs to the user — so this is retryable, unlike
   * every other reason that mentions the wallet.
   */
  | 'POPUP_BLOCKED'
  /** Anything we could not classify. */
  | 'UNKNOWN'

/** Wallet-side error kinds that map onto a definite payment failure. */
export const WALLET_ERROR_TO_FAILURE_REASON: Record<
  Exclude<NimiqErrorKind, 'USER_REJECTED'>,
  PaymentFailureReason
> = {
  PROVIDER_UNAVAILABLE: 'WALLET_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'WALLET_UNAVAILABLE',
  PROVIDER_INIT_FAILED: 'WALLET_UNAVAILABLE',
  NO_ACCOUNTS: 'WALLET_UNAVAILABLE',
  // The browser refused to open the Hub window, so the wallet was never asked
  // and nothing was broadcast. Definitely safe to retry — the user allows
  // pop-ups and presses Buy again.
  POPUP_BLOCKED: 'POPUP_BLOCKED',
  // `InvalidTransactionError` is raised before anything is broadcast, so this
  // is a definite non-payment (official Nimiq Provider API reference).
  INVALID_TRANSACTION: 'INVALID_TRANSACTION',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  NETWORK: 'NETWORK_BEFORE_SUBMIT',
  // The adapter refused before reaching the wallet, so nothing was broadcast.
  WALLET_BUSY: 'WALLET_BUSY',
  UNKNOWN: 'UNKNOWN',
}

/** States after which no further wallet interaction happens. */
export function isTerminalPaymentState(state: PaymentState): boolean {
  return (
    state.kind === 'COMPLETE' ||
    state.kind === 'CANCELLED' ||
    state.kind === 'FAILED' ||
    // Terminal for this purchase: the backend has finished deciding, and what
    // happens next is a human compensation case, not another request.
    state.kind === 'COMPENSATION_REQUIRED' ||
    state.kind === 'PURCHASE_CUTOFF' ||
    // Nothing is in flight and nothing will be. Retrying is refused again.
    state.kind === 'SELF_PURCHASE' ||
    state.kind === 'ALREADY_OWNED' ||
    state.kind === 'PURCHASE_IN_SETTLEMENT'
  )
}

/** States where the backend is still working and the UI should keep waiting. */
export function isSettlingPaymentState(state: PaymentState): boolean {
  return (
    state.kind === 'TRANSACTION_SUBMITTED' ||
    state.kind === 'VERIFYING' ||
    state.kind === 'VERIFICATION_DELAYED' ||
    state.kind === 'PENDING' ||
    state.kind === 'CONFIRMED' ||
    state.kind === 'PASS_CREATING'
  )
}

/**
 * Whether the UI may offer "Try again", i.e. may cause a *second payment*.
 *
 * Only definite non-payment outcomes qualify. `UNCERTAIN` and everything at or
 * past `TRANSACTION_SUBMITTED` must never offer one: docs/05 §55 forbids asking
 * for a second payment once a transaction may exist.
 */
export function mayRetryPayment(state: PaymentState): boolean {
  if (state.kind === 'CANCELLED') return true
  if (state.kind === 'FAILED') return !UNSAFE_TO_RETRY.has(state.reason)
  return false
}

/**
 * Failure reasons where a retry would mean a *second* payment for a
 * transaction that already exists, or a request the backend will refuse again.
 *
 * `PAYMENT_CONFLICT` is the dangerous one: it only ever arrives after the
 * wallet has broadcast, so the money has very likely moved even though this
 * purchase cannot accept the hash (docs/09-SECURITY.md §96).
 */
const UNSAFE_TO_RETRY: ReadonlySet<PaymentFailureReason> = new Set(['PAYMENT_CONFLICT'])

/**
 * Whether the primary "Buy" control may start a payment from this state.
 *
 * This is the same rule as `mayRetryPayment` plus the untouched starting state,
 * and it is deliberately *not* the inverse of `busy`. `UNCERTAIN` is the case
 * that matters: nothing is in flight, so a "still working" spinner would be a
 * lie, but a transaction may already exist — so the button must stay disabled
 * rather than offer a second payment the copy beside it explicitly warns
 * against (docs/05 §55, §62).
 *
 * `INTENT_CREATED` is excluded too: an intent already exists for this attempt,
 * and pressing Buy again would open a second native approval sheet for it.
 */
export function mayStartPayment(state: PaymentState): boolean {
  return state.kind === 'IDLE' || mayRetryPayment(state)
}

/** Whether the user has been charged, or might have been. */
export function mayHaveBeenCharged(state: PaymentState): boolean {
  return (
    isSettlingPaymentState(state) ||
    state.kind === 'UNCERTAIN' ||
    state.kind === 'COMPLETE' ||
    // Not "might have been": in compensation the backend verified the payment
    // on chain and finalised it. This one is certain.
    state.kind === 'COMPENSATION_REQUIRED' ||
    (state.kind === 'FAILED' && state.reason === 'PAYMENT_CONFLICT')
  )
}

/**
 * Whether the UI must actively tell the user *not* to send another payment.
 *
 * Stronger than "no retry button": these are the states where a well-meaning
 * customer, seeing no pass, would reasonably try paying again.
 */
export function mustWarnAgainstSecondPayment(state: PaymentState): boolean {
  return mayHaveBeenCharged(state) && state.kind !== 'COMPLETE'
}

/**
 * The backend's own do-not-pay-again flag, read from where the contract puts
 * it, with a safe default.
 *
 * A `compensation_required` purchase that arrives without its compensation
 * object is still a verified payment. Defaulting to `true` means a missing
 * field can only ever make the UI more cautious, never less.
 */
export function doNotPayAgain(state: PaymentState): boolean {
  if (state.kind !== 'COMPENSATION_REQUIRED') return false
  return state.compensation?.doNotPayAgain ?? true
}

/**
 * Whether the backend has promised an automatic refund. It has not, ever.
 *
 * Read from the wire rather than hardcoded so a future contract change shows
 * up here, but the copy that depends on it must never claim a refund is coming
 * when this is false (§7 of this milestone).
 */
export function hasAutomatedRefund(state: PaymentState): boolean {
  if (state.kind !== 'COMPENSATION_REQUIRED') return false
  return state.compensation?.automatedRefund ?? false
}

/**
 * Maps `Purchase.status` — the contract's customer-facing payment lifecycle —
 * onto the client-side state machine.
 *
 * The two are kept separate rather than merged because the client has one state
 * the server cannot have: `AWAITING_WALLET`, while a native approval sheet is
 * open and no request is in flight. Everything else is a rename, and this
 * function is the single place that rename happens.
 */
export function paymentStateFromPurchase(purchase: Purchase): PaymentState {
  switch (purchase.status) {
    case 'awaiting_payment':
      return { kind: 'INTENT_CREATED', purchase }
    case 'transaction_submitted':
      return {
        kind: 'TRANSACTION_SUBMITTED',
        purchase,
        transactionHash: purchase.transactionHash,
      }
    case 'verifying':
      return { kind: 'VERIFYING', purchase }
    // On chain and fully validated, but this deployment settles on finality,
    // so the pass waits for the macro block. Real progress, emphatically not a
    // failure, and not reachable at all under the `inclusion` policy.
    case 'awaiting_finality':
      return { kind: 'PENDING', purchase }
    // The backend could not determine an outcome — RPC trouble, or a hash it
    // cannot find yet. Never reported as failure, and never offers a retry
    // (docs/05 §62).
    case 'uncertain_retryable':
      return { kind: 'UNCERTAIN', purchase }
    case 'confirmed':
      return { kind: 'CONFIRMED', purchase }
    case 'pass_provisioning':
      return { kind: 'PASS_CREATING', purchase }
    case 'completed':
      // `completed` is only reached with a pass; if one is somehow absent, say
      // "preparing your pass" rather than linking to nothing (docs/05 §54).
      return purchase.purchasedPassId
        ? { kind: 'COMPLETE', purchase, passId: purchase.purchasedPassId }
        : { kind: 'PASS_CREATING', purchase }
    // Verified payment, no pass. Deliberately NOT folded into FAILED: the money
    // arrived and the backend knows it, so telling this customer their payment
    // failed would be both false and the fastest route to a second payment.
    case 'compensation_required':
      return { kind: 'COMPENSATION_REQUIRED', purchase, compensation: purchase.compensation }
    case 'cancelled':
      return { kind: 'CANCELLED', purchase }
    case 'expired':
      return { kind: 'FAILED', purchase, reason: 'INTENT_EXPIRED' }
    case 'permanently_failed':
      return { kind: 'FAILED', purchase, reason: 'REJECTED_BY_BACKEND' }
    default:
      // Unreachable while the union matches the contract — TypeScript proves
      // the cases above are exhaustive. It exists for the wire: a backend that
      // ships a new status this build has never heard of hands us a string no
      // case matches, and returning `undefined` from here would render nothing
      // at all beside a re-armed Buy button.
      //
      // UNCERTAIN is the only defensible answer. An unknown status is never
      // silent success, never a failure, and never an invitation to pay again
      // (§15 of this milestone).
      return { kind: 'UNCERTAIN', purchase }
  }
}
