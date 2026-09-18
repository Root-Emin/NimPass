import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authSessionRoutes, domainError, mockApi, ok } from '@/test/mock-api'
import { hubTransportDouble } from '@/test/wallet-transport'

/**
 * Desktop Login, through the real components.
 *
 * `hub-auth-flow.test.tsx` proves the flow; this proves the *screen* drives it:
 * pressing Login in an ordinary browser opens a real wallet flow, and the
 * dialog asks for the second press the Hub needs rather than silently firing a
 * window the browser would block (https://nimiq.dev/hub/getting-started).
 */

const chooseAddress = vi.fn()
const signMessage = vi.fn()

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    currentTransport: () =>
      hubTransportDouble({
        chooseAddress: (...args: []) => chooseAddress(...args),
        signMessage: (...args: [{ wallet: string; message: string }]) => signMessage(...args),
      }),
  }
})

const { renderApp, stubWallet } = await import('@/test/render')

const WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081'

const CHALLENGE = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  purpose: 'AUTH_LOGIN',
  wallet: WALLET,
  message: 'NIMPASS\nVersion: 1\nPurpose: AUTH_LOGIN\nNonce: 7f3c',
  expiresAt: '2099-01-01T00:00:00Z',
}

const SESSION = {
  identity: {
    id: 'cccccccc-0000-4000-8000-000000000001',
    wallet: WALLET,
    createdAt: '2026-01-01T00:00:00Z',
  },
  expiresAt: '2099-01-01T00:00:00Z',
  csrfToken: 'f'.repeat(64),
}

/** The desktop-browser runtime: the Hub answered, one window per click. */
const HUB_WALLET = stubWallet({
  account: null,
  capabilities: {
    nimiqProviderAvailable: true,
    walletOperationsAvailable: true,
    insideNimiqPay: false,
    transport: 'hub',
    gesturePerOperation: true,
  },
})

beforeEach(() => {
  chooseAddress.mockReset()
  signMessage.mockReset()
  chooseAddress.mockResolvedValue(WALLET)
  signMessage.mockResolvedValue({
    publicKey: 'ab'.repeat(32),
    signature: 'cd'.repeat(64),
    signer: WALLET,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Login in an ordinary browser', () => {
  it('opens a real wallet flow and signs the backend challenge across two presses', async () => {
    const { calls } = mockApi({
      '/api/v1/public/passes': () => ok({ items: [] }),
      ...authSessionRoutes(SESSION, CHALLENGE),
    })

    const user = userEvent.setup()
    renderApp('/discover', { wallet: HUB_WALLET })

    // 1. Login is a real action here, not an explanation about phones.
    await user.click(await screen.findByRole('button', { name: 'Login' }))
    expect(await screen.findByRole('heading', { name: 'Log in with your wallet' })).toBeVisible()

    // 2. First press: the wallet names an address.
    await user.click(screen.getByRole('button', { name: /Choose wallet in Nimiq Hub/i }))
    expect(await screen.findByRole('heading', { name: 'Sign to finish logging in' })).toBeVisible()
    expect(chooseAddress).toHaveBeenCalledTimes(1)
    expect(signMessage).not.toHaveBeenCalled()

    // The copy is explicit that this is not a payment (docs/09-SECURITY.md §14).
    expect(screen.getByText(/signature, not a payment/i)).toBeVisible()

    // 3. Second press: the signature, over the backend's exact message.
    await user.click(screen.getByRole('button', { name: /Sign and log in/i }))

    expect(await screen.findByRole('link', { name: 'Profile' })).toBeVisible()
    expect(signMessage).toHaveBeenCalledWith({ wallet: WALLET, message: CHALLENGE.message })
    expect(calls.find((c) => c.url === '/api/v1/auth/challenges')?.body).toEqual({ wallet: WALLET })
  }, 15_000)

  it('leaves the app usable when the Hub window is dismissed', async () => {
    chooseAddress.mockRejectedValue(new Error('CANCELED'))
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [] }),
      'GET /api/v1/auth/session': () =>
        domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
    })

    const user = userEvent.setup()
    renderApp('/discover', { wallet: HUB_WALLET })

    await user.click(await screen.findByRole('button', { name: 'Login' }))
    await user.click(screen.getByRole('button', { name: /Choose wallet in Nimiq Hub/i }))

    // A normal outcome, offered again rather than reported as a breakage.
    expect(await screen.findByRole('heading', { name: 'Login cancelled' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument()
  }, 15_000)

  it('explains a blocked pop-up and offers the retry that fixes it', async () => {
    chooseAddress.mockRejectedValue(new Error('Failed to open popup'))
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [] }),
      'GET /api/v1/auth/session': () =>
        domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
    })

    const user = userEvent.setup()
    renderApp('/discover', { wallet: HUB_WALLET })

    await user.click(await screen.findByRole('button', { name: 'Login' }))
    await user.click(screen.getByRole('button', { name: /Choose wallet in Nimiq Hub/i }))

    expect(await screen.findByText(/Allow pop-ups for this site/i)).toBeVisible()
    // Retrying is the remedy here, unlike a runtime with no wallet at all.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  }, 15_000)
})
