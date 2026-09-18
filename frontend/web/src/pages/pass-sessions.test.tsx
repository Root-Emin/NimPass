import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { domainError, mockApi, ok } from '@/test/mock-api'
import { aPassSession, aPassSessionList, aPurchasedPass, passSessions } from '@/test/fixtures'

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

/**
 * The shared session timeline, from both sides of it.
 *
 * The property under test is not "the list renders". It is that the buyer and
 * the provider are looking at *one* set of records: the same rows, the same
 * counters, the same backend. Nothing on either screen keeps its own idea of
 * how many sessions are left, which is why a provider marking a session done
 * shows up on the customer's next read rather than having to be pushed there
 * (docs/01-PRODUCT.md §33, docs/08-ARCHITECTURE.md §49).
 */

const WALLET = stubWallet()
const SESSION = stubSession()
const PASS = aPurchasedPass({ usedSessions: 2, remainingSessions: 8 })
const PROVIDER_PASS = aPurchasedPass({
  usedSessions: 2,
  remainingSessions: 8,
  viewerRole: 'PROVIDER',
})

/**
 * Ten sessions: two the provider delivered, one booked for the 20th, seven
 * nobody has arranged.
 *
 * The two completed ones are recorded by the PROVIDER on purpose — that is
 * the actor the shared-state requirement is about, and it reads differently
 * on screen from a session the owner signed for.
 */
function tenSessions() {
  return [
    ...passSessions(10, 2)
      .slice(0, 2)
      .map((session) => ({ ...session, completedBy: 'PROVIDER' as const })),
    aPassSession({
      id: '50000000-0000-4000-8000-000000000003',
      sequenceNumber: 3,
      status: 'SCHEDULED',
      scheduledAt: '2026-09-20T14:00:00Z',
    }),
    ...passSessions(10).slice(3),
  ]
}

function routes(role: 'OWNER' | 'PROVIDER', extra: Record<string, () => Response> = {}) {
  const pass = role === 'PROVIDER' ? PROVIDER_PASS : PASS
  return {
    [`/api/v1/passes/${PASS.id}`]: () => ok(pass),
    [`/api/v1/passes/${PASS.id}/sessions`]: () => ok(aPassSessionList(tenSessions(), { pass, role })),
    [`GET /api/v1/passes/${PASS.id}/redemption-challenges/current`]: () =>
      domainError(404, 'NOT_FOUND', 'none'),
    ...extra,
  }
}

describe('pass sessions', () => {
  it('shows the same rows to the provider that the buyer sees', async () => {
    mockApi(routes('PROVIDER'))

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    const timeline = (await screen.findByRole('heading', { name: 'Sessions' })).closest('section')!
    expect(within(timeline).getAllByText(/^Session \d+$/)).toHaveLength(10)
    expect(within(timeline).getAllByText(/^Confirmed by your provider ·/)).toHaveLength(2)
    expect(within(timeline).getByText(/Sep 20/)).toBeInTheDocument()

    // The provider gets the delivery control; there is no Buy-style redemption
    // for them, because they cannot spend somebody else's pass.
    expect(within(timeline).getAllByRole('button', { name: 'Mark done' })).toHaveLength(8)
    expect(screen.queryByRole('button', { name: /Use a session/ })).not.toBeInTheDocument()
  })

  it('gives the owner scheduling but not completion', async () => {
    // ADR-007: the owner spends a session by signing it in their wallet. A
    // plain button would remove that proof, and the backend refuses it — so
    // the control is not offered.
    mockApi(routes('OWNER'))

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    const timeline = (await screen.findByRole('heading', { name: 'Sessions' })).closest('section')!
    expect(within(timeline).queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument()
    expect(within(timeline).getAllByRole('button', { name: 'Schedule' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Use a session/ })).toBeInTheDocument()
  })

  it('sends a completion to the backend and renders the counts it answers with', async () => {
    let completed = false
    const target = tenSessions()[3]!
    const { calls } = mockApi(
      routes('PROVIDER', {
        [`/api/v1/passes/${PASS.id}`]: () =>
          ok({
            ...PROVIDER_PASS,
            usedSessions: completed ? 3 : 2,
            remainingSessions: completed ? 7 : 8,
          }),
        [`/api/v1/passes/${PASS.id}/sessions`]: () =>
          ok(
            aPassSessionList(
              completed
                ? tenSessions().map((s) =>
                    s.id === target.id
                      ? { ...s, status: 'COMPLETED' as const, completedAt: '2026-09-17T10:00:00Z', completedBy: 'PROVIDER' as const }
                      : s,
                  )
                : tenSessions(),
              {
                pass: { ...PROVIDER_PASS, usedSessions: completed ? 3 : 2, remainingSessions: completed ? 7 : 8 },
                role: 'PROVIDER',
              },
            ),
          ),
        [`POST /api/v1/pass-sessions/${target.id}/complete`]: () => {
          completed = true
          return ok({
            session: { ...target, status: 'COMPLETED', completedAt: '2026-09-17T10:00:00Z', completedBy: 'PROVIDER' },
            pass: { ...PROVIDER_PASS, usedSessions: 3, remainingSessions: 7 },
          })
        },
      }),
    )

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    const timeline = (await screen.findByRole('heading', { name: 'Sessions' })).closest('section')!
    const row = (await within(timeline).findByText('Session 4')).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Mark done' }))

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' && call.url === `/api/v1/pass-sessions/${target.id}/complete`,
        ),
      ).toBe(true),
    )

    // Re-read, not patched locally: the counts on screen are the ones the
    // backend wrote in the transaction that spent the session.
    expect(await screen.findByText('3 of 10 done')).toBeInTheDocument()
    expect(await within(timeline).findByText('Session 4')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(timeline).getAllByText(/^Confirmed by your provider ·/)).toHaveLength(3),
    )
  })

  it('persists a session date through the backend rather than in the screen', async () => {
    const target = tenSessions()[5]!
    const { calls } = mockApi(
      routes('OWNER', {
        [`PATCH /api/v1/pass-sessions/${target.id}/schedule`]: () =>
          ok({ ...target, status: 'SCHEDULED', scheduledAt: '2026-10-04T09:00:00Z' }),
      }),
    )

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    const timeline = (await screen.findByRole('heading', { name: 'Sessions' })).closest('section')!
    const row = (await within(timeline).findByText('Session 6')).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Schedule' }))

    // The date control is the same one the Pass form uses, so the instant is
    // picked locally and travels as UTC.
    await user.click(within(row).getByRole('button', { name: 'Choose session date' }))
    const calendar = await within(row).findByRole('dialog', { name: 'Choose a date' })
    const days = within(calendar)
      .getAllByRole('gridcell')
      .filter((cell) => !(cell as HTMLButtonElement).disabled)
    await user.click(days[days.length - 1]!)
    await user.click(within(row).getByRole('button', { name: 'Save date' }))

    await waitFor(() => {
      const call = calls.find(
        (c) => c.method === 'PATCH' && c.url === `/api/v1/pass-sessions/${target.id}/schedule`,
      )
      expect(call).toBeDefined()
      // Always sent, never omitted — an absent field would read as "clear it".
      const body = call!.body as { scheduledAt: unknown }
      expect(body).toHaveProperty('scheduledAt')
      expect(typeof body.scheduledAt).toBe('string')
    })
  })

  it('refuses to guess when the backend rejects a completion', async () => {
    const target = tenSessions()[3]!
    mockApi(
      routes('PROVIDER', {
        [`POST /api/v1/pass-sessions/${target.id}/complete`]: () =>
          domainError(409, 'REDEMPTION_ALREADY_CONSUMED', 'already consumed'),
      }),
    )

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    const timeline = (await screen.findByRole('heading', { name: 'Sessions' })).closest('section')!
    const row = (await within(timeline).findByText('Session 4')).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Mark done' }))

    expect(
      await screen.findByText(/That session was already completed/),
    ).toBeInTheDocument()
    // The counter is still the backend's, unchanged.
    expect(screen.getByText('2 of 10 done')).toBeInTheDocument()
  })
})
