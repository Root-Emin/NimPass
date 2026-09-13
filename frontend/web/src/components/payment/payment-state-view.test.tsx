import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { PaymentStateView } from './payment-state-view'
import { aPurchase } from '@/test/fixtures'

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
})
