import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { SessionProvider } from '@/app/session-provider'
import { WalletProvider } from '@/app/wallet-provider'
import { usePurchaseFlow } from '@/hooks/use-purchase-flow'
import { PurchasePanel } from './purchase-panel'
import { toPassListing, type PassListing } from '@/types/domain'
import { aPublicPass } from '@/test/mock-api'

const item: PassListing = toPassListing(aPublicPass())

/** Mirrors how the page wires the flow into the panel. */
function Harness({ pass }: { pass: PassListing }) {
  const flow = usePurchaseFlow(pass.id)
  return <PurchasePanel item={pass} flow={flow} />
}

function renderPanel(pass: PassListing = item) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WalletProvider>
        <SessionProvider>
          <MemoryRouter>
            <Harness pass={pass} />
          </MemoryRouter>
        </SessionProvider>
      </WalletProvider>
    </QueryClientProvider>,
  )
}

/**
 * jsdom is the ordinary-browser runtime: no injected Nimiq provider, so the
 * wallet is the Nimiq Hub. Buying is therefore a real, armed action here — the
 * panel must not gate it behind a phone (docs/04-NIMIQ-MINI-APPS.md §6-§8).
 *
 * Nothing is simulated: pressing it runs the real flow against the real backend
 * contract, which these tests do not stub, so nothing here can invent a
 * purchase (docs/08-ARCHITECTURE.md §14).
 */
describe('PurchasePanel in an ordinary browser', () => {
  it('shows the price and session count exactly as published', () => {
    renderPanel()
    expect(screen.getByText('250 NIM')).toBeInTheDocument()
    expect(screen.getByText('10 sessions')).toBeInTheDocument()
    expect(screen.getByText('25 NIM per session')).toBeInTheDocument()
    expect(screen.getByText(/10 sessions with Alex Fitness/)).toBeInTheDocument()
  })

  it('offers a live Buy control rather than a handoff to a phone', () => {
    renderPanel()
    const buyButton = screen.getByRole('button', { name: /Log in to buy/i })
    expect(buyButton).toBeEnabled()
    // The Nimiq Pay handoff is not the desktop wallet solution, so it is not
    // what a browser is shown in place of paying.
    expect(screen.queryByRole('link', { name: /Open in Nimiq Pay/i })).not.toBeInTheDocument()
  })

  it('does not claim any payment result before one exists', () => {
    renderPanel()
    expect(screen.queryByText(/Payment successful/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Pass added to My Passes/i)).not.toBeInTheDocument()
  })

  it('marks an inactive pass as unavailable', () => {
    renderPanel({ ...item, status: 'UNAVAILABLE' })
    expect(screen.getByRole('button', { name: 'Not available' })).toBeDisabled()
  })
})
