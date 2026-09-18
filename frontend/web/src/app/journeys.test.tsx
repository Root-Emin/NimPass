import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPass, aPublicPass, aProvider, aService, mockApi, ok } from '@/test/mock-api'
import { aPurchasedPass, aPurchasedPassPage, aPurchase } from '@/test/fixtures'
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

const OFFER = aPublicPass()
const CATALOG = OFFER.pass
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'
const PASS_ID = '00000000-0000-4000-8000-000000000004'
const WALLET = stubWallet()

const PASS = aPurchasedPass()

describe('public journey: Discover → Provider → Pass', () => {
  it('walks the whole path by clicking, with no wallet connected', async () => {
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [OFFER] }),
      // The provider rail is its own server answer now, not a by-product of the
      // passes above.
      '/api/v1/public/providers': () => ok({ items: [{ provider: OFFER.provider, passCount: 1 }] }),
      // Public links carry the stable slug, so this is the lookup the journey
      // actually performs.
      [`/api/v1/public/providers/by-slug/${OFFER.provider.slug}`]: () => ok(OFFER.provider),
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/discover')

    // Discover → Provider. Both the pass card and the provider card mention
    // the provider, so target the destination rather than the label.
    await screen.findAllByRole('link', { name: /Alex Fitness/ })
    const providerLink = screen
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === `/providers/${OFFER.provider.slug}`)
    expect(providerLink).toBeDefined()
    await user.click(providerLink!)
    expect(
      await screen.findByRole('heading', { name: 'Alex Fitness', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/providers/${OFFER.provider.slug}`)

    // Provider → Pass.
    await user.click(await screen.findByRole('link', { name: new RegExp(CATALOG.title) }))
    expect(
      await screen.findByRole('heading', { name: CATALOG.title, level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/pass/${CATALOG.id}`)

    // The whole path stayed readable without a wallet (docs/02 §5).
    expect(screen.getAllByText('250 NIM').length).toBeGreaterThan(0)
  })
})

describe('customer journey: pass → session → history', () => {
  it('reaches a pass from My Passes and offers to use a session', async () => {
    // My Passes reads the contract's own list; the pass it opens is the same
    // record, fetched by id.
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([PASS])),
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`/api/v1/passes/${PASS.id}/redemptions`]: () => ok({ items: [] }),
      '/api/v1/purchases': () =>
        ok({ items: [aPurchase({ status: 'completed', purchasedPassId: PASS.id })] }),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/passes', {
      wallet: WALLET,
      session: stubSession(),
    })

    await user.click(await screen.findByRole('link', { name: new RegExp(PASS.passTitle) }))

    expect(
      await screen.findByRole('heading', { name: PASS.passTitle, level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/passes/${PASS.id}`)

    // The number that matters most is on screen, and it is the backend's.
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Use a session/i })).toBeInTheDocument()
  })
})

describe('selling journey: Create Pass, in one screen', () => {
  it('goes from nothing to a form, with no workspace in between', async () => {
    // The whole provider experience. There is no dashboard to land on, no
    // Services screen to visit first and no navigation to learn: pressing
    // Create Pass opens the form that makes one.
    mockApi({
      '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [aService()] }),
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/provider', {
      wallet: WALLET,
      session: stubSession(),
    })

    // `/provider` lands on My Store — what this wallet has made, not metrics.
    expect(
      await screen.findByRole('heading', { name: 'My Store', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Provider workspace' })).not.toBeInTheDocument()

    // One way in, one press. The page header carries Create Pass whether or not
    // the store has anything in it, so the empty state does not repeat it: on a
    // phone the two sat a thumb apart.
    const page = within(screen.getByRole('main'))
    const [pageLink, ...extras] = page.getAllByRole('link', { name: /Create Pass/i })
    expect(extras).toHaveLength(0)
    expect(pageLink).toHaveAttribute('href', '/provider/passes/new')
    await user.click(pageLink)

    // Straight into the form: the name field is the first thing there is.
    expect(await screen.findByLabelText('Pass name')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/provider/passes/new')
  })

  it('never asks where to get paid — the login wallet already is the payout wallet', async () => {
    // What this replaces: pressing Publish opened a form asking for a Nimiq
    // address and two wallet signatures, in front of a provider who had signed
    // in with the wallet they wanted paying. The backend now adopts the
    // session's own wallet when the provider record is created (ADR-025), so
    // Publish is one press and the ceremony is gone from the flow.
    const api = mockApi({
      // Deliberately the state the old gate keyed on: whatever this client
      // believes about payout verification, the press publishes. Publishing is
      // the backend's decision and this screen no longer pre-judges it.
      '/api/v1/providers': () =>
        ok({ items: [aProvider({ id: PROVIDER_ID, payoutWallet: null, payoutVerifiedAt: null })] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [aService()] }),
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
      [`/api/v1/catalog/passes/${PASS_ID}`]: () => ok(aPass({ status: 'DRAFT' })),
      [`/api/v1/catalog/passes/${PASS_ID}/publish`]: () => ok(aPass({ status: 'ACTIVE' })),
    })

    const user = userEvent.setup()
    renderApp(`/provider/passes/${PASS_ID}/edit`, { wallet: WALLET, session: stubSession() })

    await user.click(await screen.findByRole('button', { name: /Publish Pass/i }))

    // It published. No address field, no signature step, no second press.
    await waitFor(() =>
      expect(
        api.calls.some(
          (call) =>
            call.method === 'POST' &&
            call.url === `/api/v1/catalog/passes/${PASS_ID}/publish`,
        ),
      ).toBe(true),
    )
    expect(screen.queryByLabelText('Nimiq address')).not.toBeInTheDocument()
    expect(screen.queryByText('Where you get paid')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Verify payout wallet/i })).not.toBeInTheDocument()
    // And nothing asked the backend for a payout challenge on the way.
    expect(api.calls.some((call) => call.url.includes('payout-'))).toBe(false)
  })

  it('asks nothing about services, categories or drafts', async () => {
    // The form used to open on "What's this for?" — a service picker, with a
    // category behind it and a Draft chip beside it. A Pass now derives its own
    // service from its name, so none of that is on screen.
    mockApi({
      '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
    })

    renderApp('/provider/passes/new', { wallet: WALLET, session: stubSession() })

    expect(await screen.findByLabelText('Pass name')).toBeInTheDocument()
    expect(screen.queryByLabelText(/What do you offer/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/What this pass is for/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/What is this for/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Category/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Draft/i)).not.toBeInTheDocument()
    // And no clock talk on the validity rows either.
    expect(screen.queryByText('UTC')).not.toBeInTheDocument()
    expect(screen.queryByText(/Sessions stay usable/i)).not.toBeInTheDocument()
  })
})

describe('route integrity', () => {
  it('opens every deep link on its own destination', async () => {
    // Shared links land where they point, rather than bouncing through the
    // homepage (docs/02-USER-FLOWS.md §6, docs/08-ARCHITECTURE.md §81).
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
    })

    renderApp(`/pass/${CATALOG.id}`)
    expect(
      await screen.findByRole('heading', { name: CATALOG.title, level: 1 }),
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
