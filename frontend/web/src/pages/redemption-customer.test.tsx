import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { domainError, mockApi, ok } from '@/test/mock-api'
import {
  A_REFERENCE,
  CANONICAL_REDEMPTION_MESSAGE,
  aPass,
  aRedemptionChallenge,
  aRedemptionHistoryItem,
  anAuthorizedChallenge,
} from '@/test/fixtures'

/**
 * The customer half of a redemption, end to end.
 *
 * The ceremony is create → sign → authorise → show a code, and the ordering is
 * the security model: no reference exists until the pass owner has signed the
 * server's exact message. These tests exercise the real API client, the real
 * state machine and the real screens, with Nimiq Pay doubled at the adapter
 * boundary — the one place Nimpass touches the wallet.
 *
 * The assertion that matters most is the message pass-through. If the frontend
 * ever reconstructs, trims or re-encodes the canonical message, it signs
 * different bytes than the backend verifies, and every redemption fails in a
 * way that looks like a wallet bug.
 */

const signMessage = vi.fn()

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    signMessage: (...args: unknown[]) => signMessage(...args),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')
const { NimiqOperationError, nimiqError } = await import('@/lib/nimiq')

const WALLET = stubWallet()
const SESSION = stubSession()
const PASS = aPass()
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
    [`POST ${authorizeUrl}`]: () => ok(anAuthorizedChallenge()),
    [detailUrl]: () => ok(anAuthorizedChallenge({ redemptionReference: null })),
    ...extra,
  })
}

async function startRedemption(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: PASS.packageTitle, level: 1 })
  await user.click(screen.getByRole('button', { name: /Use a session/i }))
}

describe('customer redemption ceremony', () => {
  it('signs the backend message verbatim and shows the reference it earns', async () => {
    const { calls } = redeemableBackend()

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)

    // A signing explanation comes before the native dialog, so the customer
    // knows this is not a payment (§7).
    expect(await screen.findByText('Approve this session')).toBeInTheDocument()
    expect(screen.getByText(/No NIM is sent/i)).toBeInTheDocument()
    expect(signMessage).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // THE assertion: the exact bytes, untouched.
    await waitFor(() => expect(signMessage).toHaveBeenCalledTimes(1))
    expect(signMessage).toHaveBeenCalledWith(CANONICAL_REDEMPTION_MESSAGE)
    expect(signMessage.mock.calls[0]![0]).toBe(CHALLENGE.message)

    // …and the signature is forwarded exactly as the wallet returned it.
    await waitFor(() => expect(calls.some((c) => c.url === authorizeUrl)).toBe(true))
    expect(calls.find((c) => c.url === authorizeUrl)?.body).toEqual(SIGNED)

    // The reference appears only now, and it is the backend's.
    expect(await screen.findByText('Show this to your provider')).toBeInTheDocument()
    expect(screen.getByText(A_REFERENCE)).toBeInTheDocument()
    expect(screen.getByText(/does not use a session yet/i)).toBeInTheDocument()
  })

  it('shows no reference before the signature is authorised', async () => {
    // A code that exists before authorisation would be a bearer credential
    // nobody approved (§11).
    let released: ((value: unknown) => void) | undefined
    signMessage.mockImplementation(() => new Promise((resolve) => { released = resolve }))

    redeemableBackend()
    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Waiting for your wallet…')).toBeInTheDocument()
    expect(screen.queryByText(A_REFERENCE)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('NR1:')

    released?.(SIGNED)
  })

  it('treats a dismissed wallet dialog as a cancellation, not a failure', async () => {
    // §8: no reference was minted, so nothing can be redeemed.
    signMessage.mockRejectedValue(new NimiqOperationError(nimiqError('USER_REJECTED')))
    const { calls } = redeemableBackend()

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Nothing was used')).toBeInTheDocument()
    expect(screen.getByText(/No code was created/i)).toBeInTheDocument()
    expect(calls.some((c) => c.url === authorizeUrl)).toBe(false)
    expect(document.body.textContent).not.toContain('NR1:')
    // A cancellation is recoverable.
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument()
  })

  it('never decrements the remaining count on this device', async () => {
    // The pass still reports 7 remaining throughout; only the backend moves it.
    redeemableBackend()

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Show this to your provider')

    // Dismiss via Escape: the dialog ships its own close control alongside the
    // action, so a name lookup would be ambiguous.
    await user.keyboard('{Escape}')
    // 7 of 10 — exactly what `GET /passes/{id}` said, unchanged by the ceremony.
    expect(await screen.findByText(/of 10 sessions left/)).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('reports consumption from the backend, never from arithmetic', async () => {
    // The provider confirms elsewhere; this device learns about it by reading
    // the challenge back and finding status CONSUMED (§42).
    let consumed = false
    redeemableBackend({
      [detailUrl]: () =>
        consumed
          ? ok(
              anAuthorizedChallenge({
                status: 'CONSUMED',
                redemptionReference: null,
                pass: {
                  status: 'ACTIVE',
                  originalSessions: 10,
                  usedSessions: 4,
                  remainingSessions: 6,
                  expiresAt: null,
                },
              }),
            )
          : ok(anAuthorizedChallenge({ redemptionReference: null })),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Show this to your provider')

    consumed = true

    expect(await screen.findByText('Session used', {}, { timeout: 8000 })).toBeInTheDocument()
    // 6, from the backend — not 7 minus one computed here.
    expect(screen.getByText(/6 sessions left/i)).toBeInTheDocument()
  }, 15_000)

  it('recovers an authorised challenge after a reload without inventing a code', async () => {
    // §14: reading a challenge back never returns a reference, so the honest
    // move is to offer a rotation rather than show a dead QR.
    const { calls } = mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [historyUrl]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () =>
        ok(anAuthorizedChallenge({ redemptionReference: null, qrExpiresAt: null })),
      [`POST ${challengesUrl}`]: () => ok(anAuthorizedChallenge()),
      [detailUrl]: () => ok(anAuthorizedChallenge({ redemptionReference: null })),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('Your session is still approved')).toBeInTheDocument()
    // Nothing fabricated while there is no reference.
    expect(document.body.textContent).not.toContain('NR1:')

    await user.click(screen.getByRole('button', { name: 'Show a new code' }))

    // Rotation, through the create endpoint — and no second signature.
    expect(await screen.findByText(A_REFERENCE)).toBeInTheDocument()
    expect(signMessage).not.toHaveBeenCalled()
    expect(calls.some((c) => c.url === challengesUrl && c.method === 'POST')).toBe(true)
    expect(calls.some((c) => c.url === authorizeUrl)).toBe(false)
  })

  it('shows real session history from the backend', async () => {
    // §38: no invented timeline. Ordinals come from the backend.
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
      [historyUrl]: () =>
        ok({
          items: [
            aRedemptionHistoryItem({ sessionOrdinal: 3, redeemedAt: '2026-08-20T09:00:00Z' }),
            aRedemptionHistoryItem({
              redemptionId: '70000000-0000-4000-8000-000000000002',
              sessionOrdinal: 2,
              redeemedAt: '2026-08-15T09:00:00Z',
            }),
          ],
        }),
    })

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    expect(await screen.findByRole('heading', { name: 'Sessions used' })).toBeInTheDocument()
    expect(await screen.findByText('Session 3')).toBeInTheDocument()
    expect(screen.getByText('Session 2')).toBeInTheDocument()
    // Not renumbered locally: there is no "Session 1" in this response.
    expect(screen.queryByText('Session 1')).not.toBeInTheDocument()
  })
})

/**
 * Canonical error outcomes (§48). None of these consumed a session, and none
 * may show a raw enum to the customer.
 */
describe('customer redemption errors', () => {
  it.each([
    ['REDEMPTION_CHALLENGE_EXPIRED', 410, 'That code expired'],
    ['STALE_REDEMPTION_CHALLENGE', 409, 'This code is out of date'],
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(heading)).toBeInTheDocument()

    const body = document.body.textContent ?? ''
    expect(body).not.toContain(code)
    expect(body).not.toContain('raw backend sentence')
    // Every one of these left the session unused, and the copy says so.
    expect(body).toMatch(/no session was used|already been used|already redeemed|used every session|no longer be used/i)
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

    expect(await screen.findByText('Sign in again')).toBeInTheDocument()
    expect(screen.getByText(/Nothing was used/i)).toBeInTheDocument()
    expect(signMessage).not.toHaveBeenCalled()
  })
})

/**
 * Rotation and the final session — the two flows where a stale number or a
 * stale code would do real damage.
 */
describe('challenge rotation', () => {
  it('replaces the old code on screen rather than leaving both live', async () => {
    // §12: rotating invalidates the previous reference server-side. A UI that
    // kept showing it would hand the provider a code that can only fail.
    const ROTATED = `NR1:${'99887766'.repeat(8)}`
    let rotations = 0

    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [historyUrl]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () =>
        ok(anAuthorizedChallenge({ redemptionReference: null })),
      [`POST ${challengesUrl}`]: () =>
        ok(
          anAuthorizedChallenge({
            redemptionReference: rotations++ === 0 ? A_REFERENCE : ROTATED,
          }),
        ),
      [detailUrl]: () => ok(anAuthorizedChallenge({ redemptionReference: null })),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    await user.click(await screen.findByRole('button', { name: 'Show a new code' }))
    expect(await screen.findByText(A_REFERENCE)).toBeInTheDocument()

    // Rotate again — as a second device or a second reload would.
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('button', { name: /Use a session/i }))

    expect(await screen.findByText(ROTATED)).toBeInTheDocument()
    // The superseded code is gone, not merely scrolled past.
    expect(screen.queryByText(A_REFERENCE)).not.toBeInTheDocument()
  })
})

describe('the final session', () => {
  it('shows the pass as complete from the backend, not from counting', async () => {
    // §22/§45: remaining reaches zero because the backend says so. A pass with
    // one session left is the case where an off-by-one would be invisible until
    // a customer was refused at the door.
    const LAST = aPass({ usedSessions: 9, remainingSessions: 1 })
    let consumed = false

    mockApi({
      [`/api/v1/passes/${LAST.id}`]: () =>
        ok(
          consumed
            ? { ...LAST, usedSessions: 10, remainingSessions: 0, status: 'COMPLETED' }
            : LAST,
        ),
      [historyUrl]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
      [`POST ${challengesUrl}`]: () => ok(CHALLENGE),
      [`POST ${authorizeUrl}`]: () => ok(anAuthorizedChallenge()),
      [detailUrl]: () =>
        consumed
          ? ok(
              anAuthorizedChallenge({
                status: 'CONSUMED',
                redemptionReference: null,
                pass: {
                  status: 'COMPLETED',
                  originalSessions: 10,
                  usedSessions: 10,
                  remainingSessions: 0,
                  expiresAt: null,
                },
              }),
            )
          : ok(anAuthorizedChallenge({ redemptionReference: null })),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${LAST.id}`, { wallet: WALLET, session: SESSION })
    await startRedemption(user)
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    await screen.findByText('Show this to your provider')

    // The provider confirms elsewhere.
    consumed = true

    expect(
      await screen.findByText('Session used — pass complete', {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/last session on this pass/i)).toBeInTheDocument()

    // The regression this guards: the pass flipping to COMPLETED used to
    // unmount the dialog along with the "use a session" button, so the customer
    // never saw the confirmation of their own final session.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  }, 15_000)
})
