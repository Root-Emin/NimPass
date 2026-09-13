import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '@/test/render'

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
        name: /Buy a package once/i,
        level: 1,
      }),
    ).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Nimpass — home' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.queryByText(/Vite/i)).not.toBeInTheDocument()
  })

  it('renders discover without a wallet and without crashing', async () => {
    stubUnreachableBackend()
    renderApp('/discover')

    expect(
      await screen.findByRole('heading', { name: /Services worth coming back to/i, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('search')).toBeInTheDocument()
  })

  it('shows an honest error surface when the backend is unreachable, not fake content', async () => {
    stubUnreachableBackend()
    renderApp('/discover')

    expect(await screen.findByRole('alert')).toHaveTextContent(/Can't reach Nimpass/i)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('keeps a deep-linked package URL on the package route', async () => {
    stubUnreachableBackend()
    renderApp('/packages/pkg_123')

    // The route resolves to the package page rather than bouncing to the
    // homepage (docs/02-USER-FLOWS.md §6).
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: /Buy a package once/i })).not.toBeInTheDocument()
  })

  it('explains that passes are private instead of erroring with no wallet', async () => {
    stubUnreachableBackend()
    renderApp('/passes')

    expect(await screen.findByText('Your passes are private')).toBeInTheDocument()
    expect(
      screen.getByText(/Open Nimpass in Nimiq Pay to see the passes you own\./i),
    ).toBeInTheDocument()
  })

  it('keeps the wallet control visible but secondary when no wallet exists', async () => {
    stubUnreachableBackend()
    renderApp('/')

    const walletButton = await screen.findByRole('button', { name: 'Wallet' })
    expect(walletButton).toBeInTheDocument()
  })

  it('renders the provider entry point', async () => {
    stubUnreachableBackend()
    renderApp('/provider')

    expect(
      await screen.findByRole('heading', { name: 'Overview', level: 1 }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: 'Provider workspace' }),
    ).toBeInTheDocument()
  })

  it('renders a not-found page for an unknown route', async () => {
    stubUnreachableBackend()
    renderApp('/this-route-does-not-exist')

    expect(await screen.findByText('Page not found')).toBeInTheDocument()
  })
})
