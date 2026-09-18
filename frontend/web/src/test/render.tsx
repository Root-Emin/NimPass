import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'

import { SessionContext, type SessionContextValue } from '@/app/session-context'
import { SessionProvider } from '@/app/session-provider'
import { WalletContext, type WalletContextValue } from '@/app/wallet-context'
import { WalletProvider } from '@/app/wallet-provider'
import { routes } from '@/app/router'
import { ToastProvider } from '@/components/ui/toast'
import type { AuthSession } from '@/types/auth'
import { NO_CAPABILITIES } from '@/types/wallet'

/** A query client with retries off, so failure paths assert immediately. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(ui: ReactElement): RenderResult {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <SessionProvider>
          <ToastProvider>{ui}</ToastProvider>
        </SessionProvider>
      </WalletProvider>
    </QueryClientProvider>,
  )
}

/**
 * An authenticated Nimpass session stub.
 *
 * This stands in for a *backend-issued* session so screens behind one can be
 * rendered. No business result is faked: data still comes from the mocked API.
 */
export function stubSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    identity: {
      id: '00000000-0000-4000-8000-000000000001',
      wallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
      createdAt: '2026-01-01T00:00:00Z',
    },
    expiresAt: '2099-01-01T00:00:00Z',
    csrfToken: 'f'.repeat(64),
    ...overrides,
  }
}

function stubSessionContext(session: AuthSession | null): SessionContextValue {
  return {
    session,
    isRecovering: false,
    flow: session ? { kind: 'AUTHENTICATED', session } : { kind: 'IDLE' },
    signIn: async () => session,
    signOut: async () => {},
    resetFlow: () => {},
  }
}

/**
 * A wallet context stub, for screens behind a provider session.
 *
 * This only stands in for the *runtime* — no business result is faked: data
 * still comes from the mocked API, which is what the backend would answer.
 */
export function stubWallet(overrides: Partial<WalletContextValue> = {}): WalletContextValue {
  return {
    status: 'ready',
    capabilities: {
      ...NO_CAPABILITIES,
      nimiqProviderAvailable: true,
      walletOperationsAvailable: true,
      insideNimiqPay: true,
      transport: 'mini-app',
    },
    network: 'TESTNET',
    account: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
    error: null,
    refresh: async () => {},
    noteAccount: () => {},
    ...overrides,
  }
}

/**
 * Boots the real route tree at a given URL.
 *
 * The router is returned so tests can assert on navigation and URL state — a
 * memory router does not touch `window.location`.
 */
export function renderApp(
  initialPath = '/',
  options: { wallet?: WalletContextValue; session?: AuthSession | null } = {},
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const queryClient = createTestQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })

  const routed = <RouterProvider router={router} />

  const withSession =
    options.session !== undefined ? (
      <SessionContext.Provider value={stubSessionContext(options.session)}>
        {routed}
      </SessionContext.Provider>
    ) : (
      <SessionProvider>{routed}</SessionProvider>
    )

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {options.wallet ? (
          <WalletContext.Provider value={options.wallet}>{withSession}</WalletContext.Provider>
        ) : (
          <WalletProvider>{withSession}</WalletProvider>
        )}
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...result, router }
}
