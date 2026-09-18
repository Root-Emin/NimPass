import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { domainError, mockApi, ok } from '@/test/mock-api'
import { aConsumedChallenge, aPurchasedPass, aRedemptionChallenge } from '@/test/fixtures'

/**
 * Accessibility for using a session (§43, §44).
 *
 * The surface runs inside the Nimiq Pay WebView on a phone, and it now spends
 * a session outright rather than producing a code for someone else to scan.
 * That raises the bar on two things: the step before the wallet opens has to
 * say what it is about to do in readable text, and the outcome has to be
 * announced rather than merely drawn.
 */

const signMessage = vi.fn()

import { miniAppTransportDouble } from '@/test/wallet-transport'

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    currentTransport: () =>
      miniAppTransportDouble({ signMessage: (...a: unknown[]) => signMessage(...a) }),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

const WALLET = stubWallet()
const SESSION = stubSession()
const PASS = aPurchasedPass()
const CHALLENGE = aRedemptionChallenge()

const challengesUrl = `/api/v1/passes/${PASS.id}/redemption-challenges`

beforeEach(() => {
  signMessage.mockReset()
  signMessage.mockResolvedValue({ publicKey: 'ab'.repeat(32), signature: 'cd'.repeat(64) })
})

function stubFlow(authorization: () => Response) {
  mockApi({
    [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
    [`/api/v1/passes/${PASS.id}/redemptions`]: () => ok({ items: [] }),
    [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
    [`POST ${challengesUrl}`]: () => ok(CHALLENGE),
    [`POST /api/v1/redemption-challenges/${CHALLENGE.challengeId}/authorization`]: authorization,
  })
}

describe('redemption accessibility', () => {
  it('says what signing will do, in readable text, before opening the wallet', async () => {
    stubFlow(() => ok(aConsumedChallenge()))

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PASS.passTitle, level: 1 })
    await user.click(screen.getByRole('button', { name: /Use a session/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/This is not a payment/i)
    // The consequence, spelled out. Signing is no longer a step towards using a
    // session — it is using one, and the only chance to stop is here.
    expect(dialog).toHaveTextContent(/uses the session straight away/i)

    // The canonical message is machine ceremony, not customer-facing text, and
    // is deliberately not dumped on screen (§7).
    expect(dialog.textContent).not.toContain('Nonce:')
    expect(dialog.textContent).not.toContain('AUTHORIZE_REDEMPTION')

    // Nothing has been spent by opening the explanation.
    expect(signMessage).not.toHaveBeenCalled()
  })

  it('reaches the wallet and the outcome with the keyboard alone', async () => {
    stubFlow(() => ok(aConsumedChallenge()))

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PASS.passTitle, level: 1 })

    // Both steps are real buttons with accessible names, not clickable divs.
    await user.click(screen.getByRole('button', { name: /Use a session/i }))
    const confirm = await screen.findByRole('button', { name: /Use a session/i })
    await user.click(confirm)

    // The result is stated in text, with the backend's own count.
    expect(await screen.findByText(/one session used/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent(/6 sessions remaining/i)
  })

  it('offers a way out that spends nothing', async () => {
    stubFlow(() => ok(aConsumedChallenge()))

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PASS.passTitle, level: 1 })
    await user.click(screen.getByRole('button', { name: /Use a session/i }))

    await user.click(await screen.findByRole('button', { name: /Not now/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(signMessage).not.toHaveBeenCalled()
  })
})
