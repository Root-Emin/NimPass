import { screen, within } from '@testing-library/react'
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
 * The full account log.
 *
 * Two record types, both the backend's: purchases from `GET /purchases`, and
 * consumed sessions from `GET /passes/{passID}/redemptions`. There is no third
 * kind — nothing scheduled, nothing predicted — because the contract has no
 * appointment and the product is explicit that it is not a booking system
 * (docs/01-PRODUCT.md §37).
 *
 * The log is unedited: a purchase that produced nothing still appears, because
 * hiding it is exactly what makes a payment look lost (§28-§29).
 */

const WALLET = stubWallet()
const SESSION = stubSession()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('History', () => {
  it('lists purchases in full detail alongside the sessions that were used', async () => {
    const pass = aPurchasedPass()

    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([pass])),
      '/api/v1/purchases': () =>
        ok({ items: [aPurchase({ status: 'completed', purchasedPassId: pass.id })] }),
      [`/api/v1/passes/${pass.id}/redemptions`]: () =>
        ok({
          items: [
            aRedemptionHistoryItem({ sessionOrdinal: 1 }),
            aRedemptionHistoryItem({
              redemptionId: '70000000-0000-4000-8000-000000000002',
              sessionOrdinal: 2,
              redeemedAt: '2026-08-20T09:00:00Z',
            }),
          ],
        }),
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

    renderApp('/passes/history', { wallet: WALLET, session: SESSION })

    // The purchase, with everything a customer needs to reconcile it.
    const purchase = await screen.findByRole('heading', { name: pass.passTitle })
    const entry = purchase.closest('div')!.parentElement!
    expect(entry).toHaveTextContent('250 NIM')
    expect(entry).toHaveTextContent('10 sessions')
    expect(entry).toHaveTextContent('Alex Fitness')
    expect(within(entry).getByRole('link', { name: 'Open pass' })).toHaveAttribute(
      'href',
      `/passes/${pass.id}`,
    )

    // Both sessions, numbered by the backend's own ordinal.
    expect(screen.getByText('Session 1 of 10')).toBeInTheDocument()
    expect(screen.getByText('Session 2 of 10')).toBeInTheDocument()
  })

  it('keeps a purchase that produced no pass in the log', async () => {
    // A verified payment with no entitlement is the one record that must never
    // quietly disappear (§29).
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [aCompensationPurchase()] }),
    })

    renderApp('/passes/history', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(aCompensationPurchase().passTitle)).toBeInTheDocument()
    // No pass, so no link pretending there is one.
    expect(screen.queryByRole('link', { name: 'Open pass' })).not.toBeInTheDocument()
  })

  it('asks the backend for nothing without a session', async () => {
    const { calls } = mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    renderApp('/passes/history', { wallet: WALLET, session: null })

    // The route guard answers first, so the log itself never renders.
    expect(await screen.findByText('Your passes are private')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('says so plainly when there is nothing to show', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    renderApp('/passes/history', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument()
  })

  it('surfaces a failed read instead of an empty log', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => domainError(500, 'INTERNAL_ERROR', 'boom'),
    })

    renderApp('/passes/history', { wallet: WALLET, session: SESSION })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument()
    expect(alert).not.toHaveTextContent('boom')
  })
})
