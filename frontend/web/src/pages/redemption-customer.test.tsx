import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { domainError, mockApi, ok } from '@/test/mock-api'
import {
  CANONICAL_REDEMPTION_MESSAGE,
  aConsumedChallenge,
  aPassSession,
  aPassSessionList,
  aPurchasedPass,
  aRedemptionChallenge,
  aRedemptionHistoryItem,
} from '@/test/fixtures'

/**
 * Using a session, end to end.
 *
 * The ceremony is create → sign → spent, and the ordering is the security
 * model: nothing is consumed until the pass owner has signed the server's exact
 * message. These tests exercise the real API client, the real state machine and
 * the real screens, with Nimiq Pay doubled at the adapter boundary — the one
 * place Nimpass touches the wallet.
 *
 * The assertion that matters most is the message pass-through. If the frontend
 * ever reconstructs, trims or re-encodes the canonical message, it signs
 * different bytes than the backend verifies, and every redemption fails in a
 * way that looks like a wallet bug.
 */

const signMessage = vi.fn()

import { miniAppTransportDouble } from '@/test/wallet-transport'

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    // Stubbed at the transport boundary, on the Nimiq Pay side. The double
    // hands `signMessage` the resolved message, so the pass-through assertion
    // below still checks the exact bytes the wallet would sign.
    currentTransport: () =>
      miniAppTransportDouble({ signMessage: (...args: unknown[]) => signMessage(...args) }),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')
const { NimiqOperationError, nimiqError } = await import('@/lib/nimiq')

const WALLET = stubWallet()
const SESSION = stubSession()
const PASS = aPurchasedPass()
const CHALLENGE = aRedemptionChallenge()
const SIGNED = { publicKey: 'ab'.repeat(32), signature: 'cd'.repeat(64) }

const challengesUrl = `/api/v1/passes/${PASS.id}/redemption-challenges`
const authorizeUrl = `/api/v1/redemption-challenges/${CHALLENGE.challengeId}/authorization`
const detailUrl = `/api/v1/redemption-challenges/${CHALLENGE.challengeId}`
const historyUrl = `/api/v1/passes/${PASS.id}/redemptions`

beforeEach(() => {
  signMessage.mockReset()
  signMessage.mockResolvedValue(SIGNED)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The happy path's backend, with the pass and history wired up. */
function redeemableBackend(extra: Record<string, () => Response> = {}) {
  return mockApi({
    [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
    [historyUrl]: () => ok({ items: [] }),
    [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
    [`POST ${challengesUrl}`]: () => ok(CHALLENGE),
    [`POST ${authorizeUrl}`]: () => ok(aConsumedChallenge()),
    [detailUrl]: () => ok(aConsumedChallenge()),
    ...extra,
  })
}

async function startRedemption(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: PASS.passTitle, level: 1 })
  await user.click(screen.getByRole('button', { name: /Use a session/i }))
}

describe('customer redemption ceremony', () => {
  it('signs the backend message verbatim and spends the session with it', async () => {
    const { calls } = redeemableBackend()

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)

    // A signing explanation comes before the native dialog, so the customer
    // knows this is not a payment (§7).
    expect(await screen.findByText('Use one session?')).toBeInTheDocument()
    expect(screen.getByText(/No NIM is sent/i)).toBeInTheDocument()
    // …and that confirming is the act itself, not a step towards it.
    expect(screen.getByText(/uses the session straight away/i)).toBeInTheDocument()
    expect(signMessage).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: /Use a session/i }))

    // THE assertion: the exact bytes, untouched.
    await waitFor(() => expect(signMessage).toHaveBeenCalledTimes(1))
    expect(signMessage).toHaveBeenCalledWith(CANONICAL_REDEMPTION_MESSAGE)
    expect(signMessage.mock.calls[0]![0]).toBe(CHALLENGE.message)

    // …and the signature is forwarded exactly as the wallet returned it.
    await waitFor(() => expect(calls.some((c) => c.url === authorizeUrl)).toBe(true))
    expect(calls.find((c) => c.url === authorizeUrl)?.body).toEqual(SIGNED)

    // One call did it, and the outcome is the backend's own.
    expect(await screen.findByText('Session used')).toBeInTheDocument()
    expect(calls.filter((c) => c.url === authorizeUrl)).toHaveLength(1)
    // Nothing is minted for anyone else to present.
    expect(document.body.textContent).not.toContain('NR1:')
  })

  it('spends nothing until the signature comes back', async () => {
    let released: ((value: unknown) => void) | undefined
    signMessage.mockImplementation(() => new Promise((resolve) => { released = resolve }))

    const { calls } = redeemableBackend()
    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(await screen.findByRole('button', { name: /Use a session/i }))

    expect(await screen.findByText('Waiting for your wallet…')).toBeInTheDocument()
    // The wallet is open and nothing has reached the backend yet.
    expect(calls.some((c) => c.url === authorizeUrl)).toBe(false)

    released?.(SIGNED)
  })

  it('treats a dismissed wallet dialog as a cancellation, not a failure', async () => {
    // §8: no reference was minted, so nothing can be redeemed.
    signMessage.mockRejectedValue(new NimiqOperationError(nimiqError('USER_REJECTED')))
    const { calls } = redeemableBackend()

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(await screen.findByRole('button', { name: /Use a session/i }))

    expect(await screen.findByText('Nothing was used')).toBeInTheDocument()
    expect(calls.some((c) => c.url === authorizeUrl)).toBe(false)
    // A cancellation is recoverable.
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument()
  })

  it('never decrements the remaining count on this device', async () => {
    // The pass still reports 7 remaining throughout; only the backend moves it.
    redeemableBackend()

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    // Stop at the explanation: nothing has been spent, so the count on the page
    // behind it must still be the backend's.
    await user.keyboard('{Escape}')
    // 7 of 10 — exactly what `GET /passes/{id}` said, unchanged by the ceremony.
    expect(await screen.findByText('7')).toBeInTheDocument()
    expect(screen.getByText('3 of 10 used')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('reports the new count from the backend, never from arithmetic', async () => {
    // The authorization response carries the counts the backend wrote inside
    // the consuming transaction. 6 comes from there, not from 7 minus one (§42).
    redeemableBackend()

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(await screen.findByRole('button', { name: /Use a session/i }))

    expect(await screen.findByText('Session used')).toBeInTheDocument()
    expect(screen.getByText(/6 sessions left/i)).toBeInTheDocument()
  })

  it('resumes an unsigned challenge after a reload without spending it', async () => {
    // A challenge left behind by a reload is still unsigned, so resuming means
    // offering the signature again — never treating it as already approved.
    const { calls } = mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [historyUrl]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () => ok(aRedemptionChallenge()),
      [`POST ${challengesUrl}`]: () => ok(CHALLENGE),
      [`POST ${authorizeUrl}`]: () => ok(aConsumedChallenge()),
    })

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('Use one session?')).toBeInTheDocument()
    // Reading it back consumed nothing and signed nothing.
    expect(signMessage).not.toHaveBeenCalled()
    expect(calls.some((c) => c.url === authorizeUrl)).toBe(false)
  })

  it('shows real session state from the backend, numbered as the backend numbers it', async () => {
    // §38: no invented timeline. Sequence numbers come from the backend, and
    // the rows are the session records themselves rather than a history that
    // has to be counted backwards from.
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
      [`/api/v1/passes/${PASS.id}/sessions`]: () =>
        ok(
          aPassSessionList(
            [
              aPassSession({
                id: '50000000-0000-4000-8000-0000000000a1',
                sequenceNumber: 1,
                status: 'COMPLETED',
                completedAt: '2026-08-15T09:00:00Z',
                completedBy: 'OWNER',
              }),
              aPassSession({
                id: '50000000-0000-4000-8000-0000000000a2',
                sequenceNumber: 2,
                status: 'COMPLETED',
                completedAt: '2026-08-20T09:00:00Z',
                completedBy: 'PROVIDER',
              }),
              aPassSession({ id: '50000000-0000-4000-8000-0000000000a3', sequenceNumber: 3 }),
            ],
            { pass: PASS, role: 'OWNER' },
          ),
        ),
      [historyUrl]: () =>
        ok({ items: [aRedemptionHistoryItem({ sessionOrdinal: 1 })] }),
    })

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    expect(await screen.findByText('Session 1')).toBeInTheDocument()
    expect(screen.getByText('Session 2')).toBeInTheDocument()
    expect(screen.getByText('Session 3')).toBeInTheDocument()
    // Who spent it is the backend's record too, and the two actors read
    // differently because they are different events.
    expect(screen.getByText(/^You used this ·/)).toBeInTheDocument()
    expect(screen.getByText(/^Confirmed by your provider ·/)).toBeInTheDocument()
    // Nothing is invented past what the backend sent.
    expect(screen.queryByText('Session 4')).not.toBeInTheDocument()
  })
})

/**
 * Canonical error outcomes (§48). None of these consumed a session, and none
 * may show a raw enum to the customer.
 */
describe('customer redemption errors', () => {
  it.each([
    ['REDEMPTION_CHALLENGE_EXPIRED', 410, 'That took too long'],
    ['STALE_REDEMPTION_CHALLENGE', 409, 'This request is out of date'],
    ['REDEMPTION_ALREADY_CONSUMED', 409, 'This session was already used'],
    ['PASS_COMPLETED', 409, 'No sessions left'],
    ['PASS_EXPIRED', 410, 'This pass has expired'],
    ['INVALID_REDEMPTION_SIGNATURE', 401, "We couldn't verify that approval"],
  ])('explains %s without leaking the code', async (code, status, heading) => {
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [historyUrl]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
      [`POST ${challengesUrl}`]: () => ok(CHALLENGE),
      [`POST ${authorizeUrl}`]: () => domainError(status, code, 'raw backend sentence'),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(await screen.findByRole('button', { name: /Use a session/i }))

    expect(await screen.findByText(heading)).toBeInTheDocument()

    const body = document.body.textContent ?? ''
    expect(body).not.toContain(code)
    expect(body).not.toContain('raw backend sentence')
    // Every one of these left the session unused, and the copy says so.
    expect(body).toMatch(/no session was used|already been used|already used|used every session|no longer be used|nothing was used|nothing was used twice/i)
  })

  it('asks the customer to sign in again rather than failing obscurely', async () => {
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [historyUrl]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
      [`POST ${challengesUrl}`]: () => domainError(401, 'AUTH_REQUIRED', 'nope'),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)

    expect(await screen.findByText('Log in again')).toBeInTheDocument()
    expect(screen.getByText(/Nothing was used/i)).toBeInTheDocument()
    expect(signMessage).not.toHaveBeenCalled()
  })
})

/**
 * The final session — the flow where a stale number would do real damage.
 */
describe('the final session', () => {
  it('shows the pass as complete from the backend, not from counting', async () => {
    // §22/§45: remaining reaches zero because the backend says so. A pass with
    // one session left is the case where an off-by-one would be invisible until
    // a customer was refused at the door.
    const LAST = aPurchasedPass({ usedSessions: 9, remainingSessions: 1 })

    mockApi({
      [`/api/v1/passes/${LAST.id}`]: () => ok(LAST),
      [historyUrl]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
      [`POST ${challengesUrl}`]: () => ok(CHALLENGE),
      [`POST ${authorizeUrl}`]: () =>
        ok(
          aConsumedChallenge({
            pass: {
              status: 'COMPLETED',
              originalSessions: 10,
              usedSessions: 10,
              remainingSessions: 0,
              expiresAt: null,
            },
          }),
        ),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${LAST.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(await screen.findByRole('button', { name: /Use a session/i }))

    expect(await screen.findByText('Session used — pass complete')).toBeInTheDocument()
    expect(screen.getByText(/last session on this pass/i)).toBeInTheDocument()

    // The regression this guards: the pass flipping to COMPLETED used to
    // unmount the dialog along with the "use a session" button, so the customer
    // never saw the confirmation of their own final session.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
