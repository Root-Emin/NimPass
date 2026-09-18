import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authSessionRoutes, domainError, mockApi } from '@/test/mock-api'

/**
 * Which account the wallet runtime reports, and where that knowledge comes from.
 *
 * The rule under test is the one docs/04-NIMIQ-MINI-APPS.md §55 and §87 state:
 * an account is learned from a call the user asked for, never from a page load.
 * So `account` stays null until sign-in reveals one, and Nimpass forgets it
 * again on sign-out.
 */

const listAccounts = vi.fn()
const signMessage = vi.fn()

import { miniAppTransportDouble } from '@/test/wallet-transport'

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    // Stubbed at the transport boundary, on the Nimiq Pay side: one user action
    // carries account access and signing, with no popup budget to spend.
    currentTransport: () =>
      miniAppTransportDouble({
        listAccounts: (...args: unknown[]) => listAccounts(...args),
        signMessage: (...args: unknown[]) => signMessage(...args),
      }),
  }
})

const { SessionProvider } = await import('./session-provider')
const { WalletProvider } = await import('./wallet-provider')
const { useSession } = await import('@/hooks/use-session')
const { useWallet } = await import('@/hooks/use-wallet')

const WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081'

const CHALLENGE = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  purpose: 'AUTH_LOGIN',
  wallet: WALLET,
  message: 'Nimpass Wallet Authentication\n\nAction: Sign in to Nimpass',
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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <WalletProvider>
        <SessionProvider>{children}</SessionProvider>
      </WalletProvider>
    </QueryClientProvider>
  )
}

function renderWalletAndSession() {
  return renderHook(() => ({ wallet: useWallet(), session: useSession() }), { wrapper })
}

beforeEach(() => {
  listAccounts.mockReset()
  signMessage.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the account the wallet runtime reports', () => {
  it('is unknown until the user asks for something that needs one', async () => {
    mockApi({
      'GET /api/v1/auth/session': () => domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
    })

    const { result } = renderWalletAndSession()
    await waitFor(() => expect(result.current.session.isRecovering).toBe(false))

    expect(result.current.wallet.account).toBeNull()
    // The decisive part: rendering asked the wallet for nothing.
    expect(listAccounts).not.toHaveBeenCalled()
  })

  it('is the account sign-in revealed, without a second dialog', async () => {
    listAccounts.mockResolvedValue([WALLET])
    signMessage.mockResolvedValue({ publicKey: 'pk-hex', signature: 'sig-hex' })

    mockApi(authSessionRoutes(SESSION, CHALLENGE))

    const { result } = renderWalletAndSession()
    await waitFor(() => expect(result.current.session.isRecovering).toBe(false))

    await act(async () => {
      await result.current.session.signIn()
    })
    await act(async () => { await result.current.session.signIn() })

    expect(result.current.wallet.account).toBe(WALLET)
    expect(listAccounts).toHaveBeenCalledTimes(1)
  })

  it('is forgotten on sign-out', async () => {
    listAccounts.mockResolvedValue([WALLET])
    signMessage.mockResolvedValue({ publicKey: 'pk-hex', signature: 'sig-hex' })

    mockApi({
      ...authSessionRoutes(SESSION, CHALLENGE),
      'DELETE /api/v1/auth/session': () => new Response(null, { status: 204 }),
    })

    const { result } = renderWalletAndSession()
    await waitFor(() => expect(result.current.session.isRecovering).toBe(false))
    await act(async () => {
      await result.current.session.signIn()
    })
    await act(async () => { await result.current.session.signIn() })
    expect(result.current.wallet.account).toBe(WALLET)

    await act(async () => {
      await result.current.session.signOut()
    })

    expect(result.current.wallet.account).toBeNull()
  })
})
