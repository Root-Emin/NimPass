import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { PaymentStateView } from './payment-state-view'
import { aCompensation, aCompensationPurchase, aPurchase } from '@/test/fixtures'

const purchase = aPurchase({ status: 'verifying', purchaseStatus: 'VERIFYING' })

function renderState(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('PaymentStateView', () => {
  it('tells a cancelling user they were not charged', () => {
    renderState(<PaymentStateView state={{ kind: 'CANCELLED', purchase }} onRetry={vi.fn()} />)

    expect(screen.getByText('Payment cancelled')).toBeInTheDocument()
    expect(screen.getByText('You were not charged.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('never offers a retry while the outcome is uncertain', () => {
    renderState(<PaymentStateView state={{ kind: 'UNCERTAIN', purchase }} onRetry={vi.fn()} />)

    expect(screen.getByText('Checking your payment…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByText(/Do not send another payment/i)).toBeInTheDocument()
  })

  it('does not say "failed" for an uncertain payment', () => {
    renderState(<PaymentStateView state={{ kind: 'UNCERTAIN', purchase }} />)
    expect(screen.queryByText(/couldn't be completed/i)).not.toBeInTheDocument()
  })

  it('reassures the user instead of asking for a second payment once confirmed', () => {
    renderState(<PaymentStateView state={{ kind: 'PASS_CREATING', purchase }} onRetry={vi.fn()} />)

    expect(screen.getByText('Payment received')).toBeInTheDocument()
    expect(screen.getByText('You do not need to pay again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('shows a definite failure as a failure, with a way forward', () => {
    renderState(
      <PaymentStateView
        state={{ kind: 'FAILED', purchase, reason: 'INSUFFICIENT_FUNDS' }}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText("Payment couldn't be completed")).toBeInTheDocument()
    expect(screen.getByText('Your pass was not created.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('links to the pass only once the backend produced one', () => {
    renderState(<PaymentStateView state={{ kind: 'COMPLETE', purchase, passId: 'pass_7' }} />)

    const link = screen.getByRole('link', { name: 'View pass' })
    expect(link).toHaveAttribute('href', '/passes/pass_7')
  })

  it('renders nothing while idle', () => {
    const { container } = renderState(<PaymentStateView state={{ kind: 'IDLE' }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('separates awaiting finality from doubt', () => {
    // §16: the transaction has been found. "Finalising" is progress; the copy
    // must not imply the outcome is in question.
    renderState(<PaymentStateView state={{ kind: 'PENDING', purchase }} onRetry={vi.fn()} />)

    expect(screen.getByText('Finalising your payment…')).toBeInTheDocument()
    expect(screen.getByText(/received and is still being finalised/i)).toBeInTheDocument()
    expect(screen.queryByText(/couldn't be completed/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})

/**
 * The compensation surface.
 *
 * The hard part is not what this screen says but what it must not say. The
 * backend guarantees four things — payment verified, no pass, do not pay again,
 * no automated refund — and the copy is allowed to say exactly those.
 */
describe('PaymentStateView · compensation required', () => {
  const compensated = aCompensationPurchase()

  function renderCompensation(compensation = compensated.compensation) {
    return renderState(
      <PaymentStateView
        state={{ kind: 'COMPENSATION_REQUIRED', purchase: compensated, compensation }}
        onRetry={vi.fn()}
        onReconcile={vi.fn()}
      />,
    )
  }

  it('leads with payment received and pass not issued', () => {
    renderCompensation()

    expect(
      screen.getByText('Payment received, but your pass could not be issued'),
    ).toBeInTheDocument()
    expect(screen.getByText(/no pass on your account/i)).toBeInTheDocument()
  })

  it('tells the user not to pay again', () => {
    renderCompensation()
    expect(screen.getByText(/Do not pay again/i)).toBeInTheDocument()
  })

  it('offers no retry, no re-check and no second payment', () => {
    renderCompensation()

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    // Not even "Check again": there is nothing left for the backend to decide.
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
  })

  it('claims no refund, because the backend performs none', () => {
    renderCompensation()

    const body = document.body.textContent ?? ''
    for (const claim of [
      /refund (is on its way|initiated|incoming|processed)/i,
      /funds (have been )?returned/i,
      /money back/i,
      /automatic(ally)? refund/i,
    ]) {
      expect(body, `copy implies a refund: ${claim}`).not.toMatch(claim)
    }
  })

  it('never prints the raw enum at the user', () => {
    renderCompensation()

    const body = document.body.textContent ?? ''
    expect(body).not.toContain('COMPENSATION_REQUIRED')
    expect(body).not.toContain('PACKAGE_EXPIRED_BEFORE_ACTIVATION')
    expect(body).not.toContain('compensation_required')
  })

  it('does not describe itself as a failure or a cancellation', () => {
    renderCompensation()

    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/payment failed/i)
    expect(body).not.toMatch(/couldn't be completed/i)
    expect(body).not.toMatch(/you were not charged/i)
  })

  it('shows a receipt reference so the payment is identifiable', () => {
    renderCompensation()
    expect(screen.getByText(/^Reference /)).toBeInTheDocument()
  })

  it('announces itself assertively rather than relying on colour', () => {
    // §45: a critical state that only differs by tone and icon is invisible to
    // a screen reader and to anyone who cannot separate the two colours.
    renderCompensation()

    const region = screen.getByRole('alert')
    expect(region).toHaveAttribute('aria-live', 'assertive')
    expect(region).toHaveTextContent(/could not be issued/i)
  })

  it('holds its copy even when the backend omits the compensation record', () => {
    renderCompensation(null)

    expect(
      screen.getByText('Payment received, but your pass could not be issued'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Do not pay again/i)).toBeInTheDocument()
  })

  it('reads the flags from the nested record, as the contract shapes it', () => {
    const record = aCompensation()
    expect(record.doNotPayAgain).toBe(true)
    expect(record.automatedRefund).toBe(false)
    // Guards the shape itself: these are not Purchase fields.
    expect(compensated).not.toHaveProperty('doNotPayAgain')
    expect(compensated).not.toHaveProperty('automatedRefund')
  })
})

describe('PaymentStateView · purchase cutoff', () => {
  it('explains the cutoff instead of showing a generic failure', () => {
    renderState(
      <PaymentStateView state={{ kind: 'PURCHASE_CUTOFF', purchase: null }} onRetry={vi.fn()} />,
    )

    expect(screen.getByText('Too late to buy this package')).toBeInTheDocument()
    expect(screen.getByText('You have not been charged.')).toBeInTheDocument()
    expect(screen.queryByText("Payment couldn't be completed")).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()

    const body = document.body.textContent ?? ''
    expect(body).not.toContain('PACKAGE_PURCHASE_CUTOFF')
    expect(body).not.toMatch(/409|conflict/i)
  })
})

describe('PaymentStateView · payment conflict', () => {
  it('reports the rejection without inviting a second payment', () => {
    renderState(
      <PaymentStateView
        state={{ kind: 'FAILED', purchase, reason: 'PAYMENT_CONFLICT' }}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText(/Don't send another one/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
