import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderApp, stubSession } from '@/test/render'

/**
 * Responsive behaviour is structural, not a stretched layout
 * (docs/03-DESIGN-SYSTEM.md §7, §34): desktop and mobile get different
 * navigation compositions, both rendered from the same shell.
 */
describe('application shell', () => {
  it('exposes the desktop nav and a separate mobile menu trigger', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    renderApp('/', { session: stubSession() })

    const desktopNav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(desktopNav).getByRole('link', { name: 'Discover' })).toBeInTheDocument()
    // Bought and made are separate destinations, because they are separate
    // collections — one account, two kinds of pass.
    expect(within(desktopNav).getByRole('link', { name: 'My Passes' })).toHaveAttribute(
      'href',
      '/passes',
    )
    expect(within(desktopNav).getByRole('link', { name: 'My Store' })).toHaveAttribute(
      'href',
      '/my-store',
    )
    expect(within(desktopNav).getByRole('link', { name: 'Create Pass' })).toBeInTheDocument()

    // The mobile trigger is always in the DOM and hidden with a breakpoint
    // utility, so its presence is what we assert here.
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  /**
   * Public browsing needs no wallet (docs/02-USER-FLOWS.md §5), but every
   * header destination belongs to an identity, so a signed-out visitor gets no
   * bar navigation and no menu to open — the home page is what routes them to
   * Discover, and the footer keeps that link reachable from anywhere.
   */
  it('carries no header navigation and no menu without a session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    renderApp('/', { session: null })

    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My Passes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My Store' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create Pass' })).not.toBeInTheDocument()

    // The way in, and the way to Discover, both remain.
    const footerNav = screen.getByRole('navigation', { name: 'Footer' })
    expect(within(footerNav).getByRole('link', { name: 'Discover' })).toBeInTheDocument()
    expect(within(footerNav).queryByRole('link', { name: 'My Passes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument()
  })

  it('opens a mobile menu with the same destinations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    const user = userEvent.setup()
    renderApp('/', { session: stubSession() })

    await user.click(await screen.findByRole('button', { name: 'Open menu' }))

    const mobileNav = await screen.findByRole('navigation', { name: 'Mobile' })
    expect(within(mobileNav).getByRole('link', { name: 'Discover' })).toBeInTheDocument()
    expect(within(mobileNav).getByRole('link', { name: 'My Passes' })).toBeInTheDocument()
    expect(within(mobileNav).getByRole('link', { name: 'My Store' })).toBeInTheDocument()
    expect(within(mobileNav).getByRole('link', { name: 'Create Pass' })).toBeInTheDocument()
    // The identity control is a desktop-only affordance in the bar, so the
    // menu carries the way to it.
    expect(within(mobileNav).getByRole('link', { name: 'Profile' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('provides a skip link to the main content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    renderApp('/')
    expect(await screen.findByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main',
    )

    vi.unstubAllGlobals()
  })
})
