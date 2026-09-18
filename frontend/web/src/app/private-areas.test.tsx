import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPurchasedPass, aPurchasedPassPage } from '@/test/fixtures'
import { mockApi, ok } from '@/test/mock-api'
import { renderApp, stubSession, stubWallet } from '@/test/render'

/**
 * The two areas that belong to an identity: the customer's passes and the
 * provider workspace.
 *
 * Public browsing stays open to anyone (docs/02-USER-FLOWS.md §5, §28) — this
 * file is about the other half of that rule. Without a backend-verified
 * session neither area renders: not its headings, not its navigation, not an
 * empty collection standing in for one that was never read.
 *
 * The guard is a UX boundary, never the security one. Ownership and provider
 * authorisation are decided server-side on every request, and a known URL
 * grants nothing (docs/09-SECURITY.md §32, §36, §37).
 */

const WALLET = stubWallet()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('private areas without a session', () => {
  it('does not render My Passes, and asks the backend for nothing', async () => {
    const { calls } = mockApi({ '/api/v1/passes': () => ok(aPurchasedPassPage([])) })

    renderApp('/passes', { wallet: WALLET, session: null })

    expect(await screen.findByText('Your passes are private')).toBeInTheDocument()
    // Not the page with an empty collection: the collection heading and the
    // "no passes yet" copy would both claim something was actually read.
    expect(screen.queryByRole('heading', { name: 'My Passes' })).not.toBeInTheDocument()
    expect(screen.queryByText('No passes yet')).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('keeps a deep-linked pass URL, so the pass opens once the session exists', async () => {
    const pass = aPurchasedPass()
    mockApi({ [`/api/v1/passes/${pass.id}`]: () => ok(pass) })

    const { router } = renderApp(`/passes/${pass.id}`, { wallet: WALLET, session: null })

    expect(await screen.findByText('Your passes are private')).toBeInTheDocument()
    // Destination intent survives the gate — no bounce to the homepage
    // (docs/02-USER-FLOWS.md §6, docs/08-ARCHITECTURE.md §81).
    expect(router.state.location.pathname).toBe(`/passes/${pass.id}`)
  })

  it('does not render the provider workspace, at any of its URLs', async () => {
    const { calls } = mockApi({ '/api/v1/providers': () => ok({ items: [] }) })

    renderApp('/provider/redeem', { wallet: WALLET, session: null })

    expect(
      await screen.findByRole('heading', { name: 'Log in to manage your workspace' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Provider workspace' }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(calls).toHaveLength(0))
  })

  it('offers no way into either area from the shell', async () => {
    mockApi({})

    renderApp('/', { wallet: WALLET, session: null })

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'My Passes' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: 'Create Pass' })).not.toBeInTheDocument()
    // The home page's own shortcut into the collection is gone too, while the
    // public way forward stays.
    expect(screen.queryByRole('link', { name: 'Open My Passes' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Find a Pass' }).length).toBeGreaterThan(0)
  })
})

describe('private areas with a session', () => {
  it('renders My Passes as soon as the backend has confirmed an identity', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
    })

    renderApp('/passes', { wallet: WALLET, session: stubSession() })

    expect(await screen.findByRole('heading', { name: 'My Passes' })).toBeInTheDocument()
    expect(screen.queryByText('Your passes are private')).not.toBeInTheDocument()
  })
})
