import type { Purchase } from './domain'
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
  /** Nimiq Pay is showing its native approval sheet. The user may still reject. */
  | { kind: 'AWAITING_WALLET'; purchase: Purchase }
  /** The wallet returned a transaction. Nothing is confirmed yet. */
  | { kind: 'TRANSACTION_SUBMITTED'; purchase: Purchase; transactionHash: string | null }
  /** The backend is verifying the transaction against the chain. */
  | { kind: 'VERIFYING'; purchase: Purchase }
  /** Verification is taking longer than expected. Still not a failure. */
  | { kind: 'VERIFICATION_DELAYED'; purchase: Purchase }
  /** Transaction seen but not yet included deeply enough to be accepted. */
  | { kind: 'PENDING'; purchase: Purchase }
  /** Backend accepted the payment. The pass may not exist yet. */
  | { kind: 'CONFIRMED'; purchase: Purchase }
  /** Payment is settled and the backend is provisioning the pass (§54). */
  | { kind: 'PASS_CREATING'; purchase: Purchase }
  /** Terminal success: pass exists. */
  | { kind: 'COMPLETE'; purchase: Purchase; passId: string }
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
  /** Nimiq Pay never produced a usable provider. */
  | 'WALLET_UNAVAILABLE'
  /** The backend rejected the transaction (wrong amount, recipient, reuse…). */
  | 'REJECTED_BY_BACKEND'
  /** The purchase intent expired before the transaction landed. */
  | 'INTENT_EXPIRED'
  /** Nimiq Pay rejected the transaction shape before broadcasting it. */
  | 'INVALID_TRANSACTION'
  /** The wallet has no network consensus, so a payment would be unreliable. */
  | 'NO_CONSENSUS'
  /** Network problem, definitely before the wallet submitted anything (§60). */
  | 'NETWORK_BEFORE_SUBMIT'
  /** Another native approval was already open, so this one never started. */
  | 'WALLET_BUSY'
  /** Anything we could not classify. */
  | 'UNKNOWN'

/** Provider-side error kinds that map onto a definite payment failure. */
export const WALLET_ERROR_TO_FAILURE_REASON: Record<
  Exclude<NimiqErrorKind, 'USER_REJECTED'>,
  PaymentFailureReason
> = {
  PROVIDER_UNAVAILABLE: 'WALLET_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'WALLET_UNAVAILABLE',
  PROVIDER_INIT_FAILED: 'WALLET_UNAVAILABLE',
  NO_ACCOUNTS: 'WALLET_UNAVAILABLE',
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
    state.kind === 'FAILED'
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
  return state.kind === 'CANCELLED' || state.kind === 'FAILED'
}

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
  return isSettlingPaymentState(state) || state.kind === 'UNCERTAIN' || state.kind === 'COMPLETE'
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
    // Seen on-chain, waiting for the macro block that makes it final. Real
    // progress, and emphatically not a failure.
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
      return purchase.passId
        ? { kind: 'COMPLETE', purchase, passId: purchase.passId }
        : { kind: 'PASS_CREATING', purchase }
    case 'cancelled':
      return { kind: 'CANCELLED', purchase }
    case 'expired':
      return { kind: 'FAILED', purchase, reason: 'INTENT_EXPIRED' }
    case 'permanently_failed':
      return { kind: 'FAILED', purchase, reason: 'REJECTED_BY_BACKEND' }
  }
}
