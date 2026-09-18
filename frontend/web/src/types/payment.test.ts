import { describe, expect, it } from 'vitest'

import {
  aCompensationPurchase,
  aProvisionalPurchase,
  aPurchase,
  aReversedSettlementPurchase,
  aSettlement,
} from '@/test/fixtures'

import {
  doNotPayAgain,
  hasAutomatedRefund,
  isSettlingPaymentState,
  isTerminalPaymentState,
  mayHaveBeenCharged,
  mayRetryPayment,
  mayStartPayment,
  mustWarnAgainstSecondPayment,
  paymentStateFromPurchase,
  type PaymentState,
} from './payment'

const purchase = aPurchase({ status: 'verifying', purchaseStatus: 'VERIFYING' })

describe('payment state machine', () => {
  it('offers a retry only where a second payment is safe', () => {
    expect(mayRetryPayment({ kind: 'CANCELLED', purchase })).toBe(true)
    expect(mayRetryPayment({ kind: 'FAILED', purchase, reason: 'UNKNOWN' })).toBe(true)

    // The rule that prevents double payments (docs/05 §55, §62).
    expect(mayRetryPayment({ kind: 'UNCERTAIN', purchase })).toBe(false)
    expect(mayRetryPayment({ kind: 'TRANSACTION_SUBMITTED', purchase, transactionHash: 'h' })).toBe(false)
    expect(mayRetryPayment({ kind: 'VERIFYING', purchase })).toBe(false)
    expect(mayRetryPayment({ kind: 'CONFIRMED', purchase })).toBe(false)
    expect(mayRetryPayment({ kind: 'PASS_CREATING', purchase })).toBe(false)
    expect(mayRetryPayment({ kind: 'COMPLETE', purchase, passId: 'pass_1' })).toBe(false)
  })

  it('treats cancellation and failure as different outcomes', () => {
    const cancelled: PaymentState = { kind: 'CANCELLED', purchase }
    const failed: PaymentState = { kind: 'FAILED', purchase, reason: 'INSUFFICIENT_FUNDS' }

    expect(cancelled.kind).not.toBe(failed.kind)
    expect(mayHaveBeenCharged(cancelled)).toBe(false)
    expect(mayHaveBeenCharged(failed)).toBe(false)
  })

  it('marks every post-submission state as possibly charged', () => {
    expect(mayHaveBeenCharged({ kind: 'UNCERTAIN', purchase })).toBe(true)
    expect(mayHaveBeenCharged({ kind: 'VERIFYING', purchase })).toBe(true)
    expect(mayHaveBeenCharged({ kind: 'COMPLETE', purchase, passId: 'p' })).toBe(true)
    expect(mayHaveBeenCharged({ kind: 'IDLE' })).toBe(false)
  })

  it('keeps settling states out of the terminal set', () => {
    expect(isSettlingPaymentState({ kind: 'VERIFYING', purchase })).toBe(true)
    expect(isTerminalPaymentState({ kind: 'VERIFYING', purchase })).toBe(false)
    expect(isTerminalPaymentState({ kind: 'COMPLETE', purchase, passId: 'p' })).toBe(true)
  })

  it('never reports COMPLETE for a confirmed purchase without a pass', () => {
    const confirmedNoPass = paymentStateFromPurchase(aPurchase({ status: 'pass_provisioning' }))
    expect(confirmedNoPass.kind).toBe('PASS_CREATING')

    const confirmedWithPass = paymentStateFromPurchase(
      aPurchase({ status: 'completed', purchasedPassId: 'pass_9' }),
    )
    expect(confirmedWithPass).toEqual(
      expect.objectContaining({ kind: 'COMPLETE', passId: 'pass_9' }),
    )
  })

  it('maps an expired intent to a failure the user can restart from', () => {
    const state = paymentStateFromPurchase(aPurchase({ status: 'expired' }))
    expect(state.kind).toBe('FAILED')
    expect(mayRetryPayment(state)).toBe(true)
  })
})

/**
 * COMPENSATION_REQUIRED — the state where the payment worked and the pass did
 * not exist.
 *
 * Every assertion here guards against the same mistake in a different place:
 * folding a verified payment into FAILED. That fold is what tells a customer
 * their money is gone, and a customer who believes their money is gone pays
 * again (§2, §3, §38).
 */
describe('compensation required', () => {
  const compensated = aCompensationPurchase()

  it('maps to its own state, not to FAILED and not to UNCERTAIN', () => {
    const state = paymentStateFromPurchase(compensated)

    expect(state.kind).toBe('COMPENSATION_REQUIRED')
    expect(state.kind).not.toBe('FAILED')
    expect(state.kind).not.toBe('UNCERTAIN')
    expect(state.kind).not.toBe('COMPLETE')
  })

  it('carries the backend compensation record through unchanged', () => {
    const state = paymentStateFromPurchase(compensated)

    expect(state).toEqual(
      expect.objectContaining({
        kind: 'COMPENSATION_REQUIRED',
        compensation: compensated.compensation,
      }),
    )
  })

  it('offers no retry and no way to start a second payment', () => {
    const state = paymentStateFromPurchase(compensated)

    expect(mayRetryPayment(state)).toBe(false)
    expect(mayStartPayment(state)).toBe(false)
  })

  it('treats the payment as certain, not as "possibly charged"', () => {
    const state = paymentStateFromPurchase(compensated)

    expect(mayHaveBeenCharged(state)).toBe(true)
    expect(mustWarnAgainstSecondPayment(state)).toBe(true)
    // Settled, not settling: the backend is finished, so no spinner and no poll.
    expect(isSettlingPaymentState(state)).toBe(false)
    expect(isTerminalPaymentState(state)).toBe(true)
  })

  it('reads doNotPayAgain from the nested record the contract defines', () => {
    expect(doNotPayAgain(paymentStateFromPurchase(compensated))).toBe(true)
  })

  it('still refuses a second payment when the compensation record is missing', () => {
    // A compensation purchase that arrives without its case object is still a
    // verified payment. Defaulting the flag to false — which is what reading an
    // absent field gives you — would invert the one guarantee that matters.
    const withoutRecord = aCompensationPurchase({ compensation: null })
    const state = paymentStateFromPurchase(withoutRecord)

    expect(doNotPayAgain(state)).toBe(true)
    expect(mayStartPayment(state)).toBe(false)
  })

  it('never claims an automated refund, because the backend guarantees none', () => {
    expect(hasAutomatedRefund(paymentStateFromPurchase(compensated))).toBe(false)
    expect(compensated.compensation!.automatedRefund).toBe(false)
  })

  it('produces no pass id to navigate to', () => {
    const state = paymentStateFromPurchase(compensated)
    expect(compensated.purchasedPassId).toBeNull()
    expect(state).not.toHaveProperty('passId')
  })
})

/**
 * A completed purchase whose payment is still provisional.
 *
 * The normal outcome of a fast checkout: the backend confirmed on canonical
 * inclusion and issued the pass, and the macro block that makes the payment
 * irreversible is still up to a minute away (ADR-021). Settlement is reported
 * so the purchase can be *described*, never so this side can decide whether the
 * customer may have their pass — a mapping that read `settlement.provisional`
 * and held back COMPLETE would put the old forty-second wait straight back.
 */
describe('provisional settlement', () => {
  const provisional = aProvisionalPurchase()

  it('is complete for the customer while the payment is still provisional', () => {
    const state = paymentStateFromPurchase(provisional)

    expect(provisional.settlement).toMatchObject({ status: 'INCLUDED', provisional: true })
    expect(state).toEqual(
      expect.objectContaining({ kind: 'COMPLETE', passId: provisional.purchasedPassId }),
    )
    expect(isTerminalPaymentState(state)).toBe(true)
    // Nothing left to poll for: the finality worker's progress is not the
    // customer's business, and a spinner here would be a lie about their pass.
    expect(isSettlingPaymentState(state)).toBe(false)
  })

  it('maps identically once the payment is promoted to finalised', () => {
    const finalized = aProvisionalPurchase({ settlement: aSettlement({ status: 'FINALIZED' }) })

    expect(finalized.settlement).toMatchObject({ provisional: false, finalityBlock: 1_060 })

    // The promotion is invisible here by design: same kind, same pass, same
    // affordances. Only the `settlement` the state carries along differs.
    const before = paymentStateFromPurchase(provisional)
    const after = paymentStateFromPurchase(finalized)
    expect(after.kind).toBe(before.kind)
    expect(after).toMatchObject({ passId: provisional.purchasedPassId })
    expect(isTerminalPaymentState(after)).toBe(isTerminalPaymentState(before))
    expect(mustWarnAgainstSecondPayment(after)).toBe(mustWarnAgainstSecondPayment(before))
  })

  it('never invites a second payment for a purchase that already settled', () => {
    const state = paymentStateFromPurchase(provisional)

    expect(mayRetryPayment(state)).toBe(false)
    expect(mayStartPayment(state)).toBe(false)
    expect(mayHaveBeenCharged(state)).toBe(true)
    // COMPLETE is the one charged state that needs no warning: they have the
    // pass in front of them.
    expect(mustWarnAgainstSecondPayment(state)).toBe(false)
  })
})

/**
 * The reversed settlement: an inclusion that never became canonical.
 *
 * Shares `compensation_required` with the verified-payment-no-pass case and
 * must not share its advice, because here no NIM left the wallet.
 */
describe('reversed settlement', () => {
  const reversed = aReversedSettlementPurchase()

  it('is compensation, not a failure, even though nothing was charged', () => {
    const state = paymentStateFromPurchase(reversed)

    expect(state.kind).toBe('COMPENSATION_REQUIRED')
    expect(state.kind).not.toBe('FAILED')
    expect(state.kind).not.toBe('COMPLETE')
    expect(isTerminalPaymentState(state)).toBe(true)
  })

  it('carries the backend do-not-pay-again flag through as false', () => {
    // The opposite of the expired-pass case, and the one bit of this state the
    // copy branches on. Never defaulted: see `doNotPayAgain`.
    expect(doNotPayAgain(paymentStateFromPurchase(reversed))).toBe(false)
    expect(doNotPayAgain(paymentStateFromPurchase(aCompensationPurchase()))).toBe(true)
  })

  it('reports the contested settlement alongside the compensation case', () => {
    expect(reversed.settlement).toMatchObject({
      status: 'CONTESTED',
      provisional: false,
      finalityBlock: null,
      finalizedAt: null,
      contestReason: 'SETTLEMENT_REVERSED',
    })
    expect(reversed.compensation?.reason).toBe('PAYMENT_SETTLEMENT_REVERSED')
    // Still no automated refund promised — there is nothing to refund.
    expect(hasAutomatedRefund(paymentStateFromPurchase(reversed))).toBe(false)
  })

  it('does not re-arm this intent, whatever the charge outcome was', () => {
    // A signed transaction that lost the chain can in principle be re-mined,
    // so re-paying *this* intent is not safe. A fresh purchase is.
    const state = paymentStateFromPurchase(reversed)
    expect(mayRetryPayment(state)).toBe(false)
    expect(mayStartPayment(state)).toBe(false)
  })
})

describe('unknown backend status', () => {
  it('falls back to uncertain — never to success, failure or compensation', () => {
    // A status this build has never heard of. TypeScript cannot see it; the
    // wire can produce it the day the backend ships a new state (§15).
    const future = aPurchase({ status: 'settling_on_l2' as never })
    const state = paymentStateFromPurchase(future)

    expect(state.kind).toBe('UNCERTAIN')
    expect(state.kind).not.toBe('COMPLETE')
    expect(state.kind).not.toBe('COMPENSATION_REQUIRED')
    expect(mayStartPayment(state)).toBe(false)
    expect(mayRetryPayment(state)).toBe(false)
  })
})

describe('payment conflict', () => {
  it('is a definite rejection that still must not invite a second payment', () => {
    // §33: the hash is bound to another purchase, or does not match this one.
    // The wallet broadcast, so the money very likely moved.
    const state: PaymentState = { kind: 'FAILED', purchase, reason: 'PAYMENT_CONFLICT' }

    expect(mayRetryPayment(state)).toBe(false)
    expect(mayStartPayment(state)).toBe(false)
    expect(mayHaveBeenCharged(state)).toBe(true)
  })
})

describe('purchase cutoff', () => {
  it('is not a payment failure, and is not retryable either', () => {
    const state: PaymentState = { kind: 'PURCHASE_CUTOFF', purchase: null }

    expect(mayHaveBeenCharged(state)).toBe(false)
    expect(mayRetryPayment(state)).toBe(false)
    expect(mayStartPayment(state)).toBe(false)
  })
})
