import type { PaymentState } from '@/types/payment'

/**
 * The one line a checkout shows about where the payment has got to.
 *
 * Shared by both surfaces — the desktop QR modal and the mobile confirmation
 * sheet — because they are watching one purchase through one lifecycle, and two
 * copies of this mapping would be two products' worth of wording for one
 * backend state.
 *
 * Deliberately a *projection* of `PaymentState`, not a second state machine.
 * Every value below is derived from a status the backend already reports —
 * `awaiting_payment`, `transaction_submitted`, `verifying`, `awaiting_finality`,
 * `confirmed`, `completed`, `expired`, `compensation_required` — mapped through
 * the existing `paymentStateFromPurchase`. Nothing here can advance a purchase,
 * invent a stage, or disagree with the panel beside it, because there is only
 * one source of truth and this function merely words it for a small space.
 *
 * `tone` drives colour only; the text carries the whole message on its own, for
 * anyone who cannot separate the two (docs/03-DESIGN-SYSTEM.md §45).
 */
export interface CheckoutStatus {
  tone: 'waiting' | 'progress' | 'success' | 'warning' | 'danger'
  /** The status line itself. Short — it sits under a QR code. */
  label: string
  /**
   * True while the customer still has something to do to pay: scan the code on
   * desktop, approve or hand off on a phone. False the moment a transaction
   * may exist, which is what takes the payment control off the screen.
   */
  scannable: boolean
  /** True once a transaction may exist, so the modal must not offer a way out. */
  committed: boolean
}

export function checkoutStatus(state: PaymentState): CheckoutStatus {
  switch (state.kind) {
    case 'IDLE':
    case 'CREATING_INTENT':
      return { tone: 'waiting', label: 'Preparing your payment…', scannable: false, committed: false }

    case 'INTENT_CREATED':
      return { tone: 'waiting', label: 'Waiting for payment…', scannable: true, committed: false }

    // Refused before an intent existed, so there is nothing to scan and
    // nothing at stake.
    case 'SELF_PURCHASE':
      return { tone: 'warning', label: 'This is your own pass', scannable: false, committed: false }

    // Same shape, different fact: there is nothing to scan because they are
    // already holding one of these.
    case 'ALREADY_OWNED':
      return { tone: 'warning', label: 'You already have this pass', scannable: false, committed: false }

    // A payment may exist, so this is `committed` where the two above are not:
    // nothing on screen may offer a way to pay again.
    case 'PURCHASE_IN_SETTLEMENT':
      return { tone: 'progress', label: 'Checking your last payment…', scannable: false, committed: true }

    // The one state the backend cannot report, because it is a fact about this
    // browser: a native approval sheet is open and no request is in flight
    // (`types/payment.ts`). It is named rather than folded into the line below
    // because "Payment detected" while the customer is still looking at an
    // unanswered approval sheet is simply untrue.
    //
    // `committed` is nonetheless true: the wallet may broadcast at any moment,
    // so from here on nothing may offer a way out (docs/05 §55).
    case 'AWAITING_WALLET':
      return {
        tone: 'progress',
        label: 'Waiting for approval in Nimiq Pay…',
        scannable: false,
        committed: true,
      }

    // The phone approved and reported its hash, or the backend found one. Real
    // progress, and the first moment a second payment would be a mistake.
    case 'TRANSACTION_SUBMITTED':
      return { tone: 'progress', label: 'Payment detected', scannable: false, committed: true }

    case 'VERIFYING':
      return { tone: 'progress', label: 'Verifying payment…', scannable: false, committed: true }

    case 'VERIFICATION_DELAYED':
      return {
        tone: 'warning',
        label: 'Still verifying — this is taking longer than usual',
        scannable: false,
        committed: true,
      }

    // On chain and validated, held back by a deployment that settles on the
    // macro block rather than on inclusion.
    //
    // It used to say "Waiting for finality…", and under the old policy every
    // customer read it for thirty to sixty seconds — a line about consensus
    // internals, in place of the one thing they wanted to know. Under the
    // `inclusion` policy this state is skipped and the customer goes straight
    // to confirmed. Where it is still reachable, the wording now describes
    // what is happening to their payment rather than what the chain is doing.
    case 'PENDING':
      return { tone: 'progress', label: 'Confirming payment…', scannable: false, committed: true }

    case 'CONFIRMED':
    case 'PASS_CREATING':
      return { tone: 'success', label: 'Payment confirmed — preparing your Pass…', scannable: false, committed: true }

    case 'COMPLETE':
      return { tone: 'success', label: 'Payment confirmed', scannable: false, committed: true }

    // Two different things arrive here and they must not share a sentence.
    //
    // The original case is a verified payment with no Pass: the money arrived,
    // so this is never an invitation to pay again. The other is a settlement
    // that was reversed — a pass issued on an inclusion that never became
    // canonical — where no NIM left the wallet at all and "payment received"
    // would be simply false. `doNotPayAgain` is the backend's own distinction
    // between them, so it is what this reads rather than a guess from the
    // reason string.
    case 'COMPENSATION_REQUIRED':
      return {
        tone: 'warning',
        label:
          state.compensation?.doNotPayAgain === false
            ? 'This payment did not go through — nothing was charged'
            : 'Payment received — your Pass could not be issued',
        scannable: false,
        committed: true,
      }

    case 'CANCELLED':
      return { tone: 'warning', label: 'Payment cancelled', scannable: false, committed: false }

    case 'PURCHASE_CUTOFF':
      return { tone: 'warning', label: 'This pass is too close to its end date', scannable: false, committed: false }

    case 'FAILED':
      return {
        tone: 'danger',
        label:
          state.reason === 'INTENT_EXPIRED'
            ? 'This payment request expired'
            : "Payment couldn't be completed",
        scannable: false,
        // A hash the backend refused only ever arrives after a broadcast.
        committed: state.reason === 'PAYMENT_CONFLICT',
      }

    // We cannot tell whether a transaction exists. Treated as committed, which
    // is what stops the modal offering a cancel or a fresh scan (docs/05 §62).
    case 'UNCERTAIN':
      return { tone: 'warning', label: 'Checking your payment…', scannable: false, committed: true }
  }
}
