import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { SessionProvider } from '@/app/session-provider'
import { WalletProvider } from '@/app/wallet-provider'
import { usePurchaseFlow } from '@/hooks/use-purchase-flow'
import { PurchasePanel } from './purchase-panel'
import { toPackageListing, type PackageListing } from '@/types/domain'
import { anOffer } from '@/test/mock-api'

const item: PackageListing = toPackageListing(anOffer())

/** Mirrors how the page wires the flow into the panel. */
function Harness({ pkg }: { pkg: PackageListing }) {
  const flow = usePurchaseFlow(pkg.id)
  return <PurchasePanel item={pkg} flow={flow} />
}

function renderPanel(pkg: PackageListing = item) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WalletProvider>
        <SessionProvider>
          <MemoryRouter>
            <Harness pkg={pkg} />
          </MemoryRouter>
        </SessionProvider>
      </WalletProvider>
    </QueryClientProvider>,
  )
}

/**
 * In jsdom there is no Nimiq provider, i.e. the ordinary-browser runtime.
 * Buying must be unavailable but explained — never a crash and never a
 * simulated purchase (docs/08-ARCHITECTURE.md §87, §14).
 */
describe('PurchasePanel without a wallet', () => {
  it('shows the price and session count exactly as published', () => {
    renderPanel()
    expect(screen.getByText('250 NIM')).toBeInTheDocument()
    expect(screen.getByText('10 sessions')).toBeInTheDocument()
    expect(screen.getByText('25 NIM per session')).toBeInTheDocument()
    expect(screen.getByText(/10 sessions with Alex Fitness/)).toBeInTheDocument()
  })

  it('disables buying and names the next step instead of failing', () => {
    renderPanel()
    const buyButton = screen.getByRole('button', { name: /Buy with NIM/i })
    expect(buyButton).toBeDisabled()
    expect(screen.getByText('Open Nimpass in Nimiq Pay to buy this package.')).toBeInTheDocument()
  })

  it('does not claim any payment result before one exists', () => {
    renderPanel()
    expect(screen.queryByText(/Payment successful/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Your pass is ready/i)).not.toBeInTheDocument()
  })

  it('marks an inactive package as unavailable', () => {
    renderPanel({ ...item, status: 'UNAVAILABLE' })
    expect(screen.getByRole('button', { name: 'Not available' })).toBeDisabled()
  })
})
