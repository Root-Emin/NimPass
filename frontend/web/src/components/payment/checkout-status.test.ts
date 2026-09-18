import { describe, expect, it } from 'vitest'

import { aCompensationPurchase, aPurchase } from '@/test/fixtures'
import { paymentStateFromPurchase, type PaymentState } from '@/types/payment'

import { checkoutStatus } from './checkout-status'

/**
 * The checkout status line is a *projection*, not a second state machine.
 *
 * One mapping serves both checkouts — the desktop QR modal and the mobile
 * confirmation sheet — so these assertions cover both.
 *
 * Two properties matter more than the wording, and both are safety properties:
 *
 *  - `scannable` is true in exactly one state. A code on screen next to
 *    "verifying" is how someone pays twice.
 *  - `committed` is true wherever a transaction may exist, because it is what
 *    removes the modal's way out. Getting it wrong in the safe direction costs
 *    a click; wrong in the other direction costs a customer their money.
 */

const purchase = aPurchase()

/** Every state the backend's own statuses can produce, via the real mapper. */
function fromStatus(status: string): PaymentState {
  return paymentStateFromPurchase({ ...purchase, status } as typeof purchase)
}

describe('the code is offered in exactly one state', () => {
  it('is scannable while the intent is awaiting payment', () => {
    expect(checkoutStatus(fromStatus('awaiting_payment'))).toMatchObject({
      scannable: true,
      committed: false,
      label: 'Waiting for payment…',
    })
  })

  it.each([
    'transaction_submitted',
    'verifying',
    'awaiting_finality',
    'confirmed',
    'completed',
    'uncertain_retryable',
    'compensation_required',
    'expired',
    'cancelled',
    'permanently_failed',
  ])('is not scannable once the purchase is %s', (status) => {
    expect(checkoutStatus(fromStatus(status)).scannable).toBe(false)
  })
})

describe('committed marks every state where money may have moved', () => {
  it.each([
    ['transaction_submitted', 'Payment detected'],
    ['verifying', 'Verifying payment…'],
    // Reachable only under NIMIQ_CONFIRMATION_POLICY=finality now, and worded
    // for the customer rather than for the chain: under the default inclusion
    // policy the purchase goes straight to confirmed (ADR-021).
    ['awaiting_finality', 'Confirming payment…'],
    ['uncertain_retryable', 'Checking your payment…'],
  ])('treats %s as committed', (status, label) => {
    const result = checkoutStatus(fromStatus(status))
    expect(result.committed).toBe(true)
    expect(result.label).toBe(label)
  })

  it('announces the confirmation only once the Pass actually exists', () => {
    // `completed` without a `purchasedPassId` is still provisioning, and the
    // modal must not offer a View Pass link to a Pass that is not there yet
    // (docs/05 §54). The two spellings are what tells them apart.
    expect(checkoutStatus(fromStatus('completed')).label).toMatch(/preparing your Pass/i)
    const issued = paymentStateFromPurchase({
      ...purchase,
      status: 'completed',
      purchasedPassId: '40000000-0000-4000-8000-000000000001',
    } as typeof purchase)
    expect(checkoutStatus(issued)).toMatchObject({
      label: 'Payment confirmed',
      committed: true,
      tone: 'success',
    })
  })

  it('treats a verified payment with no Pass as committed, never as a failure', () => {
    const state = paymentStateFromPurchase(aCompensationPurchase())
    const result = checkoutStatus(state)
    expect(result.committed).toBe(true)
    expect(result.tone).not.toBe('danger')
    expect(result.label).toMatch(/Payment received/)
  })

  it('leaves an unpaid intent uncommitted so it can still be let go', () => {
    expect(checkoutStatus(fromStatus('awaiting_payment')).committed).toBe(false)
    expect(checkoutStatus({ kind: 'IDLE' }).committed).toBe(false)
    expect(checkoutStatus(fromStatus('cancelled')).committed).toBe(false)
  })

  it('treats a refused hash as committed, because it only arrives after a broadcast', () => {
    // PAYMENT_CONFLICT means the backend would not bind this hash to this
    // purchase. The wallet had already sent it (docs/09-SECURITY.md §96).
    expect(
      checkoutStatus({ kind: 'FAILED', purchase, reason: 'PAYMENT_CONFLICT' }).committed,
    ).toBe(true)
    expect(
      checkoutStatus({ kind: 'FAILED', purchase, reason: 'INTENT_EXPIRED' }).committed,
    ).toBe(false)
  })
})

describe('wording', () => {
  it('names an expired request rather than blaming the payment', () => {
    expect(checkoutStatus(fromStatus('expired')).label).toBe('This payment request expired')
  })

  it('says a Pass is coming between confirmation and provisioning', () => {
    expect(checkoutStatus(fromStatus('pass_provisioning')).label).toMatch(/preparing your Pass/i)
  })

  it('names an open approval sheet as what it is, not as a detected payment', () => {
    // `AWAITING_WALLET` is the one state the backend cannot report: a native
    // approval sheet is open and no request is in flight. It used to share
    // "Payment detected" with `TRANSACTION_SUBMITTED`, which is untrue while
    // the customer is still looking at an unanswered sheet — and it is the
    // state a customer spends the most attention on.
    const waiting = checkoutStatus({ kind: 'AWAITING_WALLET', purchase })
    expect(waiting.label).toMatch(/approval in Nimiq Pay/i)
    expect(waiting.label).not.toBe(checkoutStatus(fromStatus('transaction_submitted')).label)
    // Still committed: the wallet may broadcast at any moment, so nothing may
    // offer a way out from here (docs/05 §55).
    expect(waiting.committed).toBe(true)
    expect(waiting.scannable).toBe(false)
  })

  it('gives every state a distinct sentence, so no two stages read the same', () => {
    // The defect this replaces: one word, "Working…", for creating the intent,
    // an open approval sheet, a submitted transaction, chain verification,
    // macro-block finality and pass issuance. Those take wildly different
    // amounts of time and mean entirely different things to someone who has
    // just parted with NIM.
    const stages = [
      { kind: 'CREATING_INTENT' } as const,
      fromStatus('awaiting_payment'),
      { kind: 'AWAITING_WALLET', purchase } as const,
      fromStatus('transaction_submitted'),
      fromStatus('verifying'),
      fromStatus('awaiting_finality'),
      fromStatus('pass_provisioning'),
    ]
    const labels = stages.map((state) => checkoutStatus(state).label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const label of labels) expect(label).not.toMatch(/working/i)
  })
})
