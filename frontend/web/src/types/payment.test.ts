import { describe, expect, it } from 'vitest'

import { aPurchase } from '@/test/fixtures'

import {
  isSettlingPaymentState,
  isTerminalPaymentState,
  mayHaveBeenCharged,
  mayRetryPayment,
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
