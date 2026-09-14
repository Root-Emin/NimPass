import { describe, expect, it } from 'vitest'

import { aCompensationPurchase, aPurchase } from '@/test/fixtures'

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
      aPurchase({ status: 'completed', passId: 'pass_9' }),
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
    expect(compensated.passId).toBeNull()
    expect(state).not.toHaveProperty('passId')
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
