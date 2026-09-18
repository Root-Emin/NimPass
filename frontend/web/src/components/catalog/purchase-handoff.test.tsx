import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SessionProvider } from '@/app/session-provider'
import { WalletContext, type WalletContextValue } from '@/app/wallet-context'
import { WalletProvider } from '@/app/wallet-provider'
import { usePurchaseFlow } from '@/hooks/use-purchase-flow'
import { toPassListing, type PassListing } from '@/types/domain'
import { aPublicPass } from '@/test/mock-api'
import { NO_CAPABILITIES } from '@/types/wallet'

import { PurchasePanel } from './purchase-panel'

/**
 * The Nimiq Pay handoff, and what it is *for*.
 *
 * It exists because continuing on the same pass inside Nimiq Pay beats being
 * sent to find it again (docs/04-NIMIQ-MINI-APPS.md §41-§42, docs/05 §83). It
 * is not the desktop wallet solution: an ordinary browser pays through the
 * Nimiq Hub, so the handoff appears only where no wallet could be reached at
 * all — and never in place of a working Buy button.
 *
 * Only the opener is stubbed, and only because jsdom serves the page from
 * localhost, where `miniAppOpenerUrl()` correctly refuses to offer a handoff.
 * Everything else — the wallet runtime, the flow — stays real.
 */
vi.mock('@/lib/nimiq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/nimiq')>()),
  miniAppOpenerUrl: () => 'https://nimpay.app/miniapps/open/nimpass.app/pass/pkg',
}))

const item: PassListing = toPassListing(aPublicPass())

function Harness() {
  const flow = usePurchaseFlow(item.id)
  return <PurchasePanel item={item} flow={flow} />
}

/** A runtime where neither transport could be established. */
function noWalletRuntime(): WalletContextValue {
  return {
    status: 'unavailable',
    capabilities: NO_CAPABILITIES,
    network: 'TESTNET',
    account: null,
    error: null,
    refresh: async () => {},
    noteAccount: () => {},
  }
}

function renderPanel(wallet?: WalletContextValue) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const panel = (
    <SessionProvider>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </SessionProvider>
  )
  return render(
    <QueryClientProvider client={client}>
      {wallet ? (
        <WalletContext.Provider value={wallet}>{panel}</WalletContext.Provider>
      ) : (
        <WalletProvider>{panel}</WalletProvider>
      )}
    </QueryClientProvider>,
  )
}

describe('PurchasePanel where no wallet could be reached', () => {
  it('offers the pass itself in Nimiq Pay, not a generic homepage', () => {
    renderPanel(noWalletRuntime())
    const link = screen.getByRole('link', { name: /Open in Nimiq Pay/i })
    expect(link).toHaveAttribute(
      'href',
      'https://nimpay.app/miniapps/open/nimpass.app/pass/pkg',
    )
  })

  it('states the price it will be paid at, before the wallet is involved', () => {
    // docs/05 §86: the customer knows what is about to happen before any
    // wallet dialog appears.
    renderPanel(noWalletRuntime())
    expect(
      screen.getByText('Nimpass opens in Nimiq Pay on this pass, where you can pay 250 NIM.'),
    ).toBeInTheDocument()
  })
})

describe('PurchasePanel in an ordinary browser', () => {
  it('pays here through the Hub instead of handing off to a phone', () => {
    // The real runtime resolution: jsdom has no injected provider, so the Hub
    // is the wallet and Buy is a live action. Offering only a handoff here
    // would be treating "Open in Nimiq Pay" as the desktop wallet solution.
    renderPanel()

    expect(screen.getByRole('button', { name: /Log in to buy/i })).toBeEnabled()
    expect(screen.queryByRole('link', { name: /Open in Nimiq Pay/i })).not.toBeInTheDocument()
  })
})
