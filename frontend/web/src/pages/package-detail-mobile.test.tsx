import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { anOffer, mockApi, ok } from '@/test/mock-api'
import { aCompensationPurchase, aPurchase } from '@/test/fixtures'

/**
 * The mobile purchase bar, with the panel scrolled off screen.
 *
 * Inside the Nimiq Pay WebView the viewport is small, and the purchase panel
 * leaves the screen long before a payment settles. What stays pinned to the
 * bottom is a price and a Buy button — useful while there is a payment to make,
 * and actively misleading once there is not.
 *
 * The case that matters is compensation: the panel explains that the payment
 * arrived and produced no pass, and the customer has scrolled past it. A grey
 * disabled "Buy with NIM" is then the only thing they can see, which reads as a
 * broken purchase rather than a resolved one (§46).
 *
 * jsdom has no IntersectionObserver, so the panel is always "in view" and the
 * bar never appears. These tests supply one that reports the opposite.
 */

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    sendBasicTransactionWithData: vi.fn(),
    getNetworkReadiness: vi.fn(async () => ({ consensusEstablished: true, blockNumber: 1 })),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

const OFFER = anOffer()
const PACKAGE = OFFER.package
const INTENT = aPurchase()
const PURCHASE_ID = INTENT.purchaseIntentId

const WALLET = stubWallet()
const SESSION = stubSession()

/** An IntersectionObserver that reports its target as scrolled away. */
function stubPanelOffScreen() {
  class OffScreenObserver {
    private readonly callback: IntersectionObserverCallback
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
    }
    observe(target: Element) {
      this.callback(
        [{ isIntersecting: false, target } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', OffScreenObserver)
}

beforeEach(() => {
  stubPanelOffScreen()
  // The scroll-into-view courtesy for an off-screen outcome; jsdom has no
  // layout, so the call only needs to not throw.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The bar is always in the tree; `inert` is what decides whether it is live. */
function stickyBar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.fixed.inset-x-0.bottom-0')
}

describe('mobile purchase bar', () => {
  it('keeps the price and CTA reachable while a purchase can still be made', async () => {
    mockApi({ [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER) })

    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })

    const bar = stickyBar()
    expect(bar).not.toBeNull()
    await waitFor(() => expect(bar).not.toHaveAttribute('inert'))
    expect(bar!.className).toContain('translate-y-0')
  })

  it('withdraws rather than pinning an unexplained dead button in compensation', async () => {
    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(aCompensationPurchase()),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    // The panel carries the explanation…
    expect(
      await screen.findByText('Payment received, but your pass could not be issued'),
    ).toBeInTheDocument()

    // …and the bar stands down rather than contradicting it.
    const bar = stickyBar()
    await waitFor(() => expect(bar).toHaveAttribute('inert'))
    expect(bar!.className).toContain('translate-y-full')
  })

  it('brings the explanation back on screen when the customer has scrolled past it', async () => {
    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(aCompensationPurchase()),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })
    await screen.findByText('Payment received, but your pass could not be issued')

    // Announced to a screen reader through the live region, and scrolled into
    // view for everyone else.
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
  })
})
