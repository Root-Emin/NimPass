import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { domainError, mockApi, ok } from '@/test/mock-api'
import {
  aCompensationPurchase,
  aPurchasedPass,
  aPurchasedPassPage,
  aPurchase,
  aRedemptionHistoryItem,
} from '@/test/fixtures'

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

/**
 * My Passes, against the contract's own pass list.
 *
 * This screen used to assemble its collection from `GET /purchases` plus one
 * read per `passId`, because there was no list endpoint. There is now
 * (`GET /passes`, paged, newest first), and the difference is not cosmetic: the
 * old route could not show a pass whose purchase had fallen outside the newest
 * hundred, and it spent a request per pass and per provider name.
 *
 * What is asserted here is that the screen reports the backend's answer and
 * nothing else: its numbers, its ordering, its ownership decision, its paging.
 * Ownership in particular is never evaluated here — the request carries no
 * wallet, and a pass that is not this customer's simply is not in the page
 * (docs/09-SECURITY.md §32, §36).
 */

const WALLET = stubWallet()
const SESSION = stubSession()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('My Passes', () => {
  it('lists the passes the backend returned, with the backend’s numbers', async () => {
    const pass = aPurchasedPass()

    const { calls } = mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([pass])),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(pass.passTitle)).toBeInTheDocument()
    // The figure and its unit are separate elements, so they are asserted
    // separately: 7 left out of the 10 that were bought — the backend's
    // numbers, not a count this screen worked out.
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('of 10 left')).toBeInTheDocument()

    // One request for the collection. No per-pass fan-out, and no provider
    // lookup per card: the names are snapshots on the pass itself.
    const listReads = calls.filter((call) => call.url.split('?')[0] === '/api/v1/passes')
    expect(listReads).toHaveLength(1)
    expect(calls.some((call) => call.url.startsWith('/api/v1/public/providers/'))).toBe(false)
  })

  it('pages through the collection rather than stopping at the first page', async () => {
    const first = aPurchasedPass()
    const second = aPurchasedPass({
      id: '40000000-0000-4000-8000-000000000002',
      passTitle: '8 Piano Lessons',
    })

    const { calls } = mockApi({
      '/api/v1/passes': (url) =>
        url.searchParams.get('cursor') === 'page-2'
          ? ok(aPurchasedPassPage([second]))
          : ok(aPurchasedPassPage([first], 'page-2')),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(first.passTitle)).toBeInTheDocument()
    expect(screen.queryByText(second.passTitle)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Load more passes/i }))

    expect(await screen.findByText(second.passTitle)).toBeInTheDocument()
    // The cursor was handed back exactly as received, not rebuilt.
    expect(calls.some((call) => call.url.includes('cursor=page-2'))).toBe(true)
    // End of the collection: nothing left to offer.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Load more passes/i })).not.toBeInTheDocument(),
    )
  })

  it('says the collection is empty only when the backend says so', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('No passes yet')).toBeInTheDocument()
  })

  it('surfaces a failed read instead of showing an empty collection', async () => {
    mockApi({
      '/api/v1/passes': () => domainError(500, 'INTERNAL_ERROR', 'boom'),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
    // "You own no passes" would be a claim the app has no evidence for.
    await waitFor(() => expect(screen.queryByText('No passes yet')).not.toBeInTheDocument())
    // The raw backend sentence never reaches the customer.
    expect(alert).not.toHaveTextContent('boom')
  })

  it('asks the backend for nothing without a session', async () => {
    // Passes are private, and ownership is enforced server-side. Without a
    // session there is nothing to ask for and nothing honest to show.
    const { calls } = mockApi({ '/api/v1/passes': () => ok(aPurchasedPassPage([])) })

    renderApp('/passes', { wallet: WALLET, session: null })

    expect(await screen.findByText('Your passes are private')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('shows a compensated purchase as a purchase, never as a pass', async () => {
    // §28: no entitlement exists, so no pass card may be invented for it.
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [aCompensationPurchase()] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: "Payments we're still resolving" })
    expect(screen.queryByText(/sessions remaining/i)).not.toBeInTheDocument()
  })

  it('names the provider and the price from the pass, and lists recent activity', async () => {
    // Provenance comes off the pass: `providerName` and `priceLuna` are
    // purchased snapshots, so a later rename or repricing cannot rewrite what
    // this card says was bought.
    const pass = aPurchasedPass()

    const { calls } = mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([pass])),
      '/api/v1/purchases': () =>
        ok({ items: [aPurchase({ status: 'completed', purchasedPassId: pass.id })] }),
      [`/api/v1/passes/${pass.id}/redemptions`]: () =>
        ok({ items: [aRedemptionHistoryItem({ sessionOrdinal: 3 })] }),
      [`/api/v1/public/providers/${pass.providerId}`]: () =>
        ok({
          id: pass.providerId,
          name: 'Alex Fitness',
          slug: 'alex-fitness',
          headline: '',
          bio: '',
          avatarUrl: '',
          location: '',
          wallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
        }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    // Two active passes would read "2 active passes"; one reads like this.
    expect(
      await screen.findByText('1 active pass · 7 sessions remaining in total'),
    ).toBeInTheDocument()

    const card = await screen.findByRole('link', { name: new RegExp(pass.passTitle) })
    expect(card).toHaveTextContent('with Alex Fitness')
    expect(card).toHaveTextContent('250 NIM')

    // Both kinds of event, from real records.
    const activity = (await screen.findByRole('heading', { name: 'Recent activity' })).closest(
      'section',
    )!
    expect(await within(activity).findByText('Session used')).toBeInTheDocument()
    expect(within(activity).getByText('Pass purchased')).toBeInTheDocument()
    // The ordinal and the original count are the backend's; nothing subtracts
    // one from the other to guess a balance.
    expect(within(activity).getByText('Session 3 of 10')).toBeInTheDocument()

    expect(within(activity).getByRole('link', { name: 'View history' })).toHaveAttribute(
      'href',
      '/passes/history',
    )

    // The provider record was read for the *purchase* row, not per pass card.
    const providerReads = calls.filter((call) =>
      call.url.startsWith('/api/v1/public/providers/'),
    )
    expect(providerReads.length).toBeLessThanOrEqual(1)
  })

  it('renders the collection when the session history cannot be read', async () => {
    // History is enrichment. A pass is complete without it
    // (docs/08-ARCHITECTURE.md §11).
    const pass = aPurchasedPass()

    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([pass])),
      '/api/v1/purchases': () =>
        ok({ items: [aPurchase({ status: 'completed', purchasedPassId: pass.id })] }),
      [`/api/v1/passes/${pass.id}/redemptions`]: () => domainError(500, 'INTERNAL_ERROR', 'boom'),
      [`/api/v1/public/providers/${pass.providerId}`]: () =>
        domainError(404, 'NOT_FOUND', 'gone'),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(pass.passTitle)).toBeInTheDocument()
    expect(screen.getByText('of 10 left')).toBeInTheDocument()
    // The purchase still appears; only the session rows are missing.
    expect(await screen.findByText('Pass purchased')).toBeInTheDocument()
  })

  it('separates finished passes from the ones that can still be used', async () => {
    const active = aPurchasedPass()
    const done = aPurchasedPass({
      id: '40000000-0000-4000-8000-000000000009',
      passTitle: '8 Piano Lessons',
      status: 'COMPLETED',
      originalSessions: 8,
      usedSessions: 8,
      remainingSessions: 0,
      completedAt: '2026-09-01T10:00:00Z',
    })

    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([active, done])),
      '/api/v1/purchases': () => ok({ items: [] }),
      [`/api/v1/passes/${active.id}/redemptions`]: () => ok({ items: [] }),
      [`/api/v1/passes/${done.id}/redemptions`]: () => ok({ items: [] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    const completed = (await screen.findByRole('heading', { name: 'Completed' })).closest(
      'section',
    )!
    expect(within(completed).getByText('8 Piano Lessons')).toBeInTheDocument()
    expect(within(completed).getByText(/all 8 sessions used/)).toBeInTheDocument()
    // The finished pass is not dressed up as a live one.
    expect(within(completed).queryByText('of 8 left')).not.toBeInTheDocument()
  })
})

/**
 * Ownership of a purchased pass is the backend's fact, not the browser's.
 *
 * The purchase that produced it, the wallet that paid, and the session that
 * happened to be open at the time are all irrelevant to whether the pass is
 * still there afterwards. `GET /passes` is scoped server-side to the
 * authenticated account, so the only way the collection can appear is if the
 * backend owns it — which is exactly what these assert.
 */
describe('a pass belongs to the account, not to the tab that bought it', () => {
  it('appears from the backend alone, with nothing carried over from the purchase', async () => {
    const pass = aPurchasedPass()
    const { calls } = mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([pass])),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(pass.passTitle)).toBeInTheDocument()
    // The request carries no wallet and no owner id — if it did, the frontend
    // would be asserting ownership rather than reading it (§32, §36).
    const listRead = calls.find((call) => call.url.split('?')[0] === '/api/v1/passes')!
    expect(listRead.url).not.toMatch(/wallet|owner/i)
    expect(listRead.body).toBeUndefined()
  })

  it('is still there on a cold mount with no memory of the purchase', async () => {
    // Standing in for log out, log back in, or open it on another device:
    // a fresh application with an empty cache asks the backend and gets the
    // pass back. Nothing about it was ever local.
    const pass = aPurchasedPass()
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([pass])),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    const first = renderApp('/passes', { wallet: WALLET, session: SESSION })
    expect(await screen.findByText(pass.passTitle)).toBeInTheDocument()
    first.unmount()

    localStorage.clear()
    sessionStorage.clear()

    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([pass])),
      '/api/v1/purchases': () => ok({ items: [] }),
    })
    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(pass.passTitle)).toBeInTheDocument()
    expect(screen.getByText('of 10 left')).toBeInTheDocument()
  })

  it('shows nothing when the backend reports no passes for this account', async () => {
    // The mirror image, and the one that would catch a screen quietly
    // remembering a pass it had already seen.
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('No passes yet')).toBeInTheDocument()
  })
})
