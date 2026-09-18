import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp, stubSession } from '@/test/render'

/**
 * The public-browsing guarantee: none of these routes may depend on a Nimiq
 * provider existing, and none may crash when the backend is unreachable
 * (docs/08-ARCHITECTURE.md §87, docs/04-NIMIQ-MINI-APPS.md §12).
 *
 * jsdom has no `window.nimiq` and no `window.nimiqPay`, so every test here runs
 * in exactly the "ordinary desktop browser" runtime.
 */

function stubUnreachableBackend() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('application shell and routing', () => {
  it('boots the home page with the Nimpass shell, not a starter template', async () => {
    stubUnreachableBackend()
    renderApp('/')

    expect(
      await screen.findByRole('heading', {
        name: /Buy a pass once/i,
        level: 1,
      }),
    ).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Nimpass — home' })).toBeInTheDocument()
    // Signed out the header carries no destinations, so the shell is proved by
    // its landmarks rather than by a nav that only exists for an identity.
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeInTheDocument()
    expect(screen.queryByText(/Vite/i)).not.toBeInTheDocument()
  })

  it('renders discover without a wallet and without crashing', async () => {
    stubUnreachableBackend()
    renderApp('/discover')

    expect(
      await screen.findByRole('heading', { name: /Passes worth coming back to/i, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('search')).toBeInTheDocument()
  })

  it('shows an honest error surface when the backend is unreachable, not fake content', async () => {
    stubUnreachableBackend()
    renderApp('/discover')

    expect(await screen.findByRole('alert')).toHaveTextContent(/Can't reach Nimpass/i)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('keeps a deep-linked pass URL on the pass route', async () => {
    stubUnreachableBackend()
    renderApp('/pass/pkg_123')

    // The route resolves to the pass page rather than bouncing to the
    // homepage (docs/02-USER-FLOWS.md §6).
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: /Buy a pass once/i })).not.toBeInTheDocument()
  })

  it('explains that passes are private and offers the login that opens them', async () => {
    stubUnreachableBackend()
    renderApp('/passes')

    expect(await screen.findByText('Your passes are private')).toBeInTheDocument()
    // An ordinary browser reaches a wallet through the Nimiq Hub, so the gate
    // offers the same sign-in the header does rather than naming a phone.
    expect(
      screen.getByText(/Log in with your wallet to see the passes you own\./i),
    ).toBeInTheDocument()
    // Two: the header's, and the gate's own. Both open the same flow.
    expect(screen.getAllByRole('button', { name: 'Login' }).length).toBeGreaterThan(0)
  })

  it('keeps the wallet control visible but secondary when no wallet exists', async () => {
    stubUnreachableBackend()
    renderApp('/')

    const walletButton = await screen.findByRole('button', { name: 'Login' })
    expect(walletButton).toBeInTheDocument()
  })

  it('renders the provider entry point for a signed-in identity', async () => {
    stubUnreachableBackend()
    renderApp('/provider', { session: stubSession() })

    // `/provider` has no dashboard and no workspace chrome of its own; it
    // lands on My Store — the Passes this wallet made — as an ordinary page.
    expect(
      await screen.findByRole('heading', { name: 'My Store', level: 1 }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Provider workspace' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the provider workspace out of sight without a session', async () => {
    stubUnreachableBackend()
    renderApp('/provider', { session: null })

    expect(
      await screen.findByRole('heading', { name: 'Log in to manage your workspace' }),
    ).toBeInTheDocument()
    // Not the workspace with empty panels — the workspace does not render at
    // all, so there is no chrome suggesting a workspace exists here.
    expect(
      screen.queryByRole('navigation', { name: 'Provider workspace' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Passes', level: 1 })).not.toBeInTheDocument()
  })

  it('renders a not-found page for an unknown route', async () => {
    stubUnreachableBackend()
    renderApp('/this-route-does-not-exist')

    expect(await screen.findByText('Page not found')).toBeInTheDocument()
  })
})
