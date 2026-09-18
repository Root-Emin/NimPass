import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aProvider, domainError, mockApi, ok } from '@/test/mock-api'
import { renderApp, stubWallet } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WALLET = stubWallet()
const SESSION = {
  identity: {
    id: 'cccccccc-0000-4000-8000-000000000001',
    wallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
    createdAt: '2026-01-01T00:00:00Z',
  },
  expiresAt: '2099-01-01T00:00:00Z',
  csrfToken: 'f'.repeat(64),
}
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'

/**
 * What happens when a session ends underneath an open tab.
 *
 * Sessions expire, get revoked, or are replaced by a sign-in elsewhere. The
 * failure this guards against is the UI continuing to assert an authorisation
 * the server has already withdrawn (docs/09-SECURITY.md §64-§66).
 */
describe('session expiry', () => {
  it('stops claiming the user is signed in once the server rejects the session', async () => {
    // The session endpoint still hands back a valid-looking session — an
    // expired cookie is only discovered when something protected is requested.
    mockApi({
      'GET /api/v1/auth/session': () => ok(SESSION),
      '/api/v1/purchases': () => domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
    })

    renderApp('/passes', { wallet: WALLET })

    // The 401 on the pass read is what reveals the truth. The app must follow
    // the server rather than the session object it is still holding: no stale
    // wallet in the header, and the signed-out surface instead of an error.
    await waitFor(() => expect(screen.getByText('Your passes are private')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument()

    // And it fails closed — no pass data is left rendered (docs/09 §66, §124).
    expect(screen.queryByText(/sessions remaining/)).not.toBeInTheDocument()
  })

  it('drops cached provider data with the session, not just the header', async () => {
    // Wallet A's workspace loads, then the session dies. Wallet A's data must
    // not stay on screen for whoever signs in next (docs/09-SECURITY.md §66).
    let servicesCalls = 0
    mockApi({
      'GET /api/v1/auth/session': () => ok(SESSION),
      '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => {
        servicesCalls += 1
        return servicesCalls === 1
          ? ok({ items: [] })
          : domainError(401, 'AUTH_REQUIRED', 'Authentication required')
      },
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
    })

    renderApp('/provider', { wallet: WALLET })

    await waitFor(() =>
      expect(screen.getByText('Log in to manage your workspace')).toBeInTheDocument(),
    )
  })

  it('treats a 401 on the session probe itself as simply signed out', async () => {
    // An anonymous visitor gets 401 from the session endpoint. That is the
    // normal state, not an expiry event, and must not raise an error surface.
    mockApi({
      'GET /api/v1/auth/session': () => domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
      '/api/v1/public/passes': () => ok({ items: [] }),
    })

    renderApp('/discover', { wallet: WALLET })

    expect(
      await screen.findByRole('heading', { name: /Passes worth coming back to/i, level: 1 }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Login' })).toBeInTheDocument()
  })
})
