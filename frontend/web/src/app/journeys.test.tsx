import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { anOffer, aProvider, aService, mockApi, ok } from '@/test/mock-api'
import { aPass, aPurchase } from '@/test/fixtures'
import { renderApp, stubSession, stubWallet } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Cross-milestone journeys.
 *
 * The unit tests prove each surface in isolation. These prove the seams still
 * line up: that Milestone 2's public pages still reach Milestone 3's purchase
 * boundary, and that Milestone 3.5's redemption work did not break either.
 *
 * They walk the routes the way a person does — by clicking — so a link that
 * points at the wrong path fails here rather than in front of a judge
 * (docs/02-USER-FLOWS.md §131).
 */

const OFFER = anOffer()
const PACKAGE = OFFER.package
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'
const WALLET = stubWallet()

const PASS = aPass()

describe('public journey: Discover → Provider → Package', () => {
  it('walks the whole path by clicking, with no wallet connected', async () => {
    mockApi({
      '/api/v1/public/packages': () => ok({ items: [OFFER] }),
      [`/api/v1/public/providers/${PROVIDER_ID}`]: () => ok(OFFER.provider),
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/discover')

    // Discover → Provider. Both the package card and the provider card mention
    // the provider, so target the destination rather than the label.
    await screen.findAllByRole('link', { name: /Alex Fitness/ })
    const providerLink = screen
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === `/providers/${PROVIDER_ID}`)
    expect(providerLink).toBeDefined()
    await user.click(providerLink!)
    expect(
      await screen.findByRole('heading', { name: 'Alex Fitness', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/providers/${PROVIDER_ID}`)

    // Provider → Package.
    await user.click(await screen.findByRole('link', { name: new RegExp(PACKAGE.title) }))
    expect(
      await screen.findByRole('heading', { name: PACKAGE.title, level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/packages/${PACKAGE.id}`)

    // The whole path stayed readable without a wallet (docs/02 §5).
    expect(screen.getAllByText('250 NIM').length).toBeGreaterThan(0)
  })
})

describe('customer journey: pass → session → history', () => {
  it('reaches a pass from My Passes and offers to use a session', async () => {
    // My Passes is assembled from the purchases that produced the passes,
    // because the contract has no pass list.
    mockApi({
      '/api/v1/purchases': () =>
        ok({ items: [aPurchase({ status: 'completed', passId: PASS.id })] }),
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/passes', {
      wallet: WALLET,
      session: stubSession(),
    })

    await user.click(await screen.findByRole('link', { name: new RegExp(PASS.packageTitle) }))

    expect(
      await screen.findByRole('heading', { name: PASS.packageTitle, level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/passes/${PASS.id}`)

    // The number that matters most is on screen, and it is the backend's.
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Use a session/i })).toBeInTheDocument()
  })
})

describe('provider journey: workspace → services → packages → redeem', () => {
  it('moves between every workspace section', async () => {
    mockApi({
      '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [aService()] }),
      [`/api/v1/providers/${PROVIDER_ID}/packages`]: () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/provider', {
      wallet: WALLET,
      session: stubSession(),
    })

    const nav = await screen.findByRole('navigation', { name: 'Provider workspace' })

    await user.click(within(nav).getByRole('link', { name: 'Services' }))
    expect(await screen.findByRole('heading', { name: 'Services', level: 1 })).toBeInTheDocument()

    await user.click(within(nav).getByRole('link', { name: 'Packages' }))
    expect(await screen.findByRole('heading', { name: 'Packages', level: 1 })).toBeInTheDocument()

    await user.click(within(nav).getByRole('link', { name: 'Redeem' }))
    expect(
      await screen.findByRole('heading', { name: 'Redeem a session', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/provider/redeem')
  })
})

describe('route integrity', () => {
  it('opens every deep link on its own destination', async () => {
    // Shared links land where they point, rather than bouncing through the
    // homepage (docs/02-USER-FLOWS.md §6, docs/08-ARCHITECTURE.md §81).
    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
    })

    renderApp(`/packages/${PACKAGE.id}`)
    expect(
      await screen.findByRole('heading', { name: PACKAGE.title, level: 1 }),
    ).toBeInTheDocument()
  })

  it('sends an unknown route to the not-found page, not an error boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    renderApp('/provider/nope/deeper')
    expect(await screen.findByText('Page not found')).toBeInTheDocument()
  })
})
