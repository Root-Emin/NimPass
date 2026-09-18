import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { domainError, mockApi, ok } from '@/test/mock-api'
import {
  aPassSession,
  aPassSessionList,
  aPurchase,
  aPurchasedPass,
  aRedemptionHistoryItem,
  passSessions,
} from '@/test/fixtures'

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

/**
 * Pass Detail, minus redemption — the flow itself is covered in
 * `redemption-customer.test.tsx`.
 *
 * What is asserted here is the facts panel and the timeline: three records
 * (the pass, its purchase, the public provider) composed into one screen, each
 * one optional, and none of them substituted for when it is missing
 * (docs/08-ARCHITECTURE.md §11).
 */

const WALLET = stubWallet()
const SESSION = stubSession()
const PASS = aPurchasedPass()

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The pass's ten sessions: three used, one booked, the rest open. */
const SESSIONS = [
  ...passSessions(10, 3).slice(0, 3),
  aPassSession({
    id: '50000000-0000-4000-8000-000000000004',
    sequenceNumber: 4,
    status: 'SCHEDULED',
    scheduledAt: '2026-09-20T14:00:00Z',
  }),
  ...passSessions(10).slice(4),
]

function mountWith(extra: Record<string, () => Response> = {}) {
  return mockApi({
    [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
    [`/api/v1/passes/${PASS.id}/sessions`]: () =>
      ok(aPassSessionList(SESSIONS, { pass: PASS, role: 'OWNER' })),
    [`/api/v1/passes/${PASS.id}/redemptions`]: () =>
      ok({ items: [aRedemptionHistoryItem({ sessionOrdinal: 1 })] }),
    [`/api/v1/public/providers/${PASS.providerId}`]: () =>
      ok({ id: PASS.providerId, name: 'Alex Fitness' }),
    [`/api/v1/purchases/${PASS.purchaseId}`]: () =>
      ok(aPurchase({ status: 'completed', purchasedPassId: PASS.id })),
    [`GET /api/v1/passes/${PASS.id}/redemption-challenges/current`]: () =>
      domainError(404, 'NOT_FOUND', 'none'),
    ...extra,
  })
}

describe('Pass detail', () => {
  it('states the facts of the pass without deriving any of them', async () => {
    mountWith()

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    expect(
      await screen.findByRole('heading', { name: PASS.passTitle, level: 1 }),
    ).toBeInTheDocument()

    const panel = (await screen.findByRole('heading', { name: 'Pass details' })).parentElement!

    expect(within(panel).getByText('Alex Fitness')).toBeInTheDocument()
    // Counters as the backend reports them, never recomputed.
    expect(within(panel).getByText('3 used of 10')).toBeInTheDocument()
    // The paid amount lives on the purchase, not on the pass.
    expect(within(panel).getByText('250 NIM')).toBeInTheDocument()
    // No fixed expiry on this pass, so the panel says nothing about expiry —
    // neither a date nor a sentence announcing the absence of one.
    expect(within(panel).queryByText('Valid until')).not.toBeInTheDocument()
    expect(within(panel).queryByText(/No expiry/i)).not.toBeInTheDocument()
    // A real prefix of the real id — not a reformatted reference code.
    const reference = within(panel).getByTitle(PASS.id)
    expect(reference).toHaveTextContent('40000000')
  })

  it('lists every session, not only the ones already used', async () => {
    // The old timeline read the redemption history, so a pass with seven left
    // showed three rows and nothing about the seven. Every session the pass
    // was sold with is a record now, and all ten are on screen.
    mountWith()

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    const timeline = (await screen.findByRole('heading', { name: 'Sessions' })).closest('section')!

    expect(await within(timeline).findByText('Session 1')).toBeInTheDocument()
    expect(within(timeline).getByText('Session 10')).toBeInTheDocument()
    expect(within(timeline).getAllByText(/^Session \d+$/)).toHaveLength(10)

    // Three states, each said in words rather than by colour alone (§19).
    expect(within(timeline).getAllByText(/^You used this ·/)).toHaveLength(3)
    expect(within(timeline).getAllByText('Not scheduled')).toHaveLength(6)
  })

  it('shows a scheduled session by its date, and lets the owner change it', async () => {
    mountWith()

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    const timeline = (await screen.findByRole('heading', { name: 'Sessions' })).closest('section')!
    const scheduled = (await within(timeline).findByText('Session 4')).closest('li')!

    // The date the backend stored, rendered locally.
    expect(within(scheduled).getByText(/Sep 20/)).toBeInTheDocument()
    expect(within(scheduled).getByRole('button', { name: 'Reschedule' })).toBeInTheDocument()
    // Completing is the provider's move; an owner spends a session by signing
    // it in their wallet, so this control is not offered to them.
    expect(within(scheduled).queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument()
  })

  it('tells each party how the shared timeline is meant to be used', async () => {
    mountWith()

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    expect(
      await screen.findByText(/Give a session a date when you and Alex Fitness agree one/),
    ).toBeInTheDocument()
  })

  it('reads provider, service and price off the pass, with no second request', async () => {
    // These were three records — the pass, the public provider, and the
    // purchase that produced it — and two of them could fail. They are
    // purchased snapshots on the pass now, so the page states them plainly and
    // a renamed or re-priced pass cannot rewrite what was bought.
    const { calls } = mountWith({})

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    expect(
      await screen.findByRole('heading', { name: PASS.passTitle, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()

    const panel = screen.getByRole('heading', { name: 'Pass details' }).parentElement!
    expect(within(panel).getByText(PASS.providerName)).toBeInTheDocument()
    expect(within(panel).getByText(PASS.serviceName)).toBeInTheDocument()
    expect(within(panel).getByText('Paid')).toBeInTheDocument()
    expect(within(panel).getByText('250 NIM')).toBeInTheDocument()

    // Neither the provider record nor the purchase is read for this screen.
    expect(calls.some((call) => call.url.startsWith('/api/v1/public/providers/'))).toBe(false)
    expect(calls.some((call) => call.url.startsWith('/api/v1/purchases/'))).toBe(false)
  })
})
