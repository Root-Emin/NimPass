import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { domainError, mockApi, ok } from '@/test/mock-api'
import { aCompensationPurchase, aPass, aPurchase } from '@/test/fixtures'

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

/**
 * My Passes, and the endpoint it does not have.
 *
 * `backend/openapi.yaml` defines exactly one pass route — `GET /passes/{passID}`
 * — and no list. So the collection is assembled the only way the contract
 * allows: read the customer's purchases, take the `passId` each one produced,
 * and fetch those individually.
 *
 * That is a workaround with real edges, and they are tested here rather than
 * left to be discovered. `GET /purchases` returns at most 100 rows, so a
 * customer past that number silently loses their oldest passes; the ordering is
 * the purchase's, not the pass's; and a pass that cannot be read must not blank
 * the rest. Ownership is never decided here — it is the backend's answer to
 * each request, and a pass belonging to someone else is a 404 (§25, §30).
 */

const WALLET = stubWallet()
const SESSION = stubSession()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('My Passes', () => {
  it('reaches passes through the purchases that produced them', async () => {
    const pass = aPass()

    const { calls } = mockApi({
      '/api/v1/purchases': () =>
        ok({ items: [aPurchase({ status: 'completed', passId: pass.id })] }),
      [`/api/v1/passes/${pass.id}`]: () => ok(pass),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(pass.packageTitle)).toBeInTheDocument()
    expect(screen.getByText(/of 10 sessions left/)).toBeInTheDocument()

    // No list endpoint was invented.
    expect(calls.some((call) => call.url === '/api/v1/passes')).toBe(false)
    expect(calls.some((call) => call.url === '/api/v1/me/passes')).toBe(false)
  })

  it('asks for nothing when no purchase produced a pass', async () => {
    const { calls } = mockApi({
      '/api/v1/purchases': () =>
        ok({ items: [aPurchase({ status: 'cancelled', passId: null })] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('No passes yet')).toBeInTheDocument()
    expect(calls.some((call) => call.url.startsWith('/api/v1/passes/'))).toBe(false)
  })

  it('keeps the readable passes when one cannot be read', async () => {
    // A pass that 404s — revoked, or simply not this wallet's — must not blank
    // the collection. Ownership is the backend's call; the honest response to
    // "not yours" is to show what is (§30).
    const mine = aPass()
    const theirs = aPass({ id: '40000000-0000-4000-8000-0000000000ff' })

    mockApi({
      '/api/v1/purchases': () =>
        ok({
          items: [
            aPurchase({ status: 'completed', passId: mine.id }),
            aPurchase({
              purchaseIntentId: 'aaaaaaaa-0000-4000-8000-000000000002',
              status: 'completed',
              passId: theirs.id,
            }),
          ],
        }),
      [`/api/v1/passes/${mine.id}`]: () => ok(mine),
      [`/api/v1/passes/${theirs.id}`]: () => domainError(404, 'NOT_FOUND', 'gone'),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(mine.packageTitle)).toBeInTheDocument()
    expect(screen.queryByText('No passes yet')).not.toBeInTheDocument()
    // One card, not two, and no error state.
    expect(screen.getAllByText(/of 10 sessions left/)).toHaveLength(1)
  })

  it('surfaces a failed purchase read instead of showing an empty collection', async () => {
    // The purchase list is the first hop. If it fails, "you own no passes" is
    // a claim the app cannot make.
    mockApi({ '/api/v1/purchases': () => domainError(500, 'INTERNAL_ERROR', 'boom') })

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
    const { calls } = mockApi({ '/api/v1/purchases': () => ok({ items: [] }) })

    renderApp('/passes', { wallet: WALLET, session: null })

    expect(await screen.findByText('Your passes are private')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('shows a compensated purchase as a purchase, never as a pass', async () => {
    // §28: no entitlement exists, so no pass card may be invented for it.
    mockApi({ '/api/v1/purchases': () => ok({ items: [aCompensationPurchase()] }) })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: "Payments we're still resolving" })
    expect(screen.queryByText(/sessions left/i)).not.toBeInTheDocument()
  })
})
