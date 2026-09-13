import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderApp } from '@/test/render'

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

    renderApp('/')

    const desktopNav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(desktopNav).getByRole('link', { name: 'Discover' })).toBeInTheDocument()
    expect(within(desktopNav).getByRole('link', { name: 'My Passes' })).toBeInTheDocument()
    expect(within(desktopNav).getByRole('link', { name: 'For Providers' })).toBeInTheDocument()

    // The mobile trigger is always in the DOM and hidden with a breakpoint
    // utility, so its presence is what we assert here.
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('opens a mobile menu with the same destinations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    const user = userEvent.setup()
    renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'Open menu' }))

    const mobileNav = await screen.findByRole('navigation', { name: 'Mobile' })
    expect(within(mobileNav).getByRole('link', { name: 'Discover' })).toBeInTheDocument()

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
