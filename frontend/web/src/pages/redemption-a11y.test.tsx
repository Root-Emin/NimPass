import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aProvider, domainError, mockApi, ok } from '@/test/mock-api'
import { A_REFERENCE, aPass, aRedemptionChallenge, anAuthorizedChallenge } from '@/test/fixtures'

/**
 * Accessibility and small-screen behaviour for redemption (§43, §44).
 *
 * The customer surface is the one that matters most here: it runs inside the
 * Nimiq Pay WebView on a phone, and its primary output is a QR code — which is
 * worth nothing to a screen reader, and worth nothing to a provider whose
 * camera does not work. So the reference has to exist as text, every time, and
 * the ticking countdown has to stay out of the way.
 */

const signMessage = vi.fn()

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return { ...actual, NIMIQ_NETWORK: 'TESTNET', signMessage: (...a: unknown[]) => signMessage(...a) }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

const WALLET = stubWallet()
const SESSION = stubSession()
const PASS = aPass()
const PROVIDER = aProvider()
const CHALLENGE = aRedemptionChallenge()

const challengesUrl = `/api/v1/passes/${PASS.id}/redemption-challenges`

beforeEach(() => {
  signMessage.mockReset()
  signMessage.mockResolvedValue({ publicKey: 'ab'.repeat(32), signature: 'cd'.repeat(64) })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function reachQrCode(user: ReturnType<typeof userEvent.setup>) {
  mockApi({
    [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
    [`/api/v1/passes/${PASS.id}/redemptions`]: () => ok({ items: [] }),
    [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
    [`POST ${challengesUrl}`]: () => ok(CHALLENGE),
    [`POST /api/v1/redemption-challenges/${CHALLENGE.challengeId}/authorization`]: () =>
      ok(anAuthorizedChallenge()),
    [`/api/v1/redemption-challenges/${CHALLENGE.challengeId}`]: () =>
      ok(anAuthorizedChallenge({ redemptionReference: null })),
  })

  renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
  await screen.findByRole('heading', { name: PASS.packageTitle, level: 1 })
  await user.click(screen.getByRole('button', { name: /Use a session/i }))
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
  await screen.findByText('Show this to your provider')
}

describe('redemption accessibility', () => {
  it('carries the reference as text, not only as a QR image', async () => {
    const user = userEvent.setup()
    await reachQrCode(user)

    // The code itself, readable and selectable.
    expect(screen.getByText(A_REFERENCE)).toBeInTheDocument()
    expect(screen.getByText('Session code:')).toBeInTheDocument()

    // The image carries nothing a screen reader needs, so it is presentational
    // rather than an img with the whole code stuffed into its alt text. The QR
    // encoder loads on demand, so wait for it to paint.
    await waitFor(() => expect(document.querySelector('img')).not.toBeNull())
    const qr = document.querySelector('img')!
    expect(qr).toHaveAttribute('alt', '')
    expect(qr).toHaveAttribute('role', 'presentation')
  })

  it('does not announce the countdown every second', async () => {
    const user = userEvent.setup()
    await reachQrCode(user)

    // The ticking text is hidden from assistive tech…
    const ticking = screen.getByText(/Expires in/)
    expect(ticking).toHaveAttribute('aria-hidden', 'true')

    // …and the live region holds a threshold message, not a clock.
    const live = document.querySelector('[role="status"][aria-live="polite"].sr-only')
    expect(live).not.toBeNull()
    expect(live!.textContent).toBe('Session code ready. Show it to your provider.')
    expect(live!.textContent).not.toMatch(/\d+:\d\d/)
  })

  it('explains the signature before opening the wallet, in readable text', async () => {
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`/api/v1/passes/${PASS.id}/redemptions`]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
      [`POST ${challengesUrl}`]: () => ok(CHALLENGE),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PASS.packageTitle, level: 1 })
    await user.click(screen.getByRole('button', { name: /Use a session/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Approve this session')
    expect(dialog).toHaveTextContent(/This is not a payment/i)

    // The canonical message is machine ceremony, not customer-facing text, and
    // is deliberately not dumped on screen (§7).
    expect(dialog.textContent).not.toContain('Nonce:')
    expect(dialog.textContent).not.toContain('AUTHORIZE_REDEMPTION')
  })

  it('keeps the provider flow reachable by keyboard alone', async () => {
    mockApi({
      '/api/v1/providers': () => ok({ items: [PROVIDER] }),
      [`/api/v1/providers/${PROVIDER.id}/redemptions`]: () => ok({ items: [] }),
    })

    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })

    // Both paths in are real controls with accessible names — the scanner is
    // never the only way to redeem (§35, §37, §43).
    expect(await screen.findByLabelText(/Session code/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Look up code/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start scanning/i })).toBeInTheDocument()
  })

  it('gives every camera outcome a message rather than a silent dead end', async () => {
    // §35: "allow the camera", "this device has no camera" and "this page is
    // not HTTPS" need three different responses, and none of them may leave the
    // provider looking at a button that does nothing.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(
      join(process.cwd(), 'src', 'pages', 'provider', 'redeem.tsx'),
      'utf8',
    )
    for (const status of [
      'denied',
      'no-camera',
      'insecure-context',
      'unsupported',
      'error',
    ]) {
      // Hyphenated keys are quoted in the record; match either spelling.
      const declared = source.includes(`${status}:`) || source.includes(`'${status}':`)
      expect(declared, `camera status ${status} has no copy`).toBe(true)
    }
    // Each one points at the typed path as the way forward.
    expect(source.match(/Type the code instead/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
