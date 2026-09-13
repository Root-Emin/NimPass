import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SessionProvider } from '@/app/session-provider'
import { WalletProvider } from '@/app/wallet-provider'
import { usePurchaseFlow } from '@/hooks/use-purchase-flow'
import { toPackageListing, type PackageListing } from '@/types/domain'
import { anOffer } from '@/test/mock-api'

import { PurchasePanel } from './purchase-panel'

/**
 * The browser → Nimiq Pay handoff (docs/04-NIMIQ-MINI-APPS.md §41-§42,
 * docs/05-NIMIQ-PAY-INTEGRATION.md §83).
 *
 * Only the opener is stubbed, and only because jsdom serves the page from
 * localhost, where `miniAppOpenerUrl()` correctly refuses to offer a handoff.
 * Everything else — the wallet runtime, the flow — stays real: this asserts
 * what a customer on a public URL is shown, not a mocked purchase.
 */
vi.mock('@/lib/nimiq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/nimiq')>()),
  miniAppOpenerUrl: () => 'https://nimpay.app/miniapps/open/nimpass.app/packages/pkg',
}))

const item: PackageListing = toPackageListing(anOffer())

function Harness() {
  const flow = usePurchaseFlow(item.id)
  return <PurchasePanel item={item} flow={flow} />
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WalletProvider>
        <SessionProvider>
          <MemoryRouter>
            <Harness />
          </MemoryRouter>
        </SessionProvider>
      </WalletProvider>
    </QueryClientProvider>,
  )
}

describe('PurchasePanel in a browser that can hand off to Nimiq Pay', () => {
  it('offers the package itself in Nimiq Pay, not a generic homepage', () => {
    renderPanel()
    const link = screen.getByRole('link', { name: /Open in Nimiq Pay/i })
    expect(link).toHaveAttribute(
      'href',
      'https://nimpay.app/miniapps/open/nimpass.app/packages/pkg',
    )
  })

  it('states the price it will be paid at, before the wallet is involved', () => {
    // docs/05 §86: the customer knows what is about to happen before any
    // native dialog appears.
    renderPanel()
    expect(
      screen.getByText('Nimpass opens in Nimiq Pay on this package, where you can pay 250 NIM.'),
    ).toBeInTheDocument()
  })

  it('still offers no way to buy in this runtime', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: /Buy with NIM/i })).not.toBeInTheDocument()
  })
})
