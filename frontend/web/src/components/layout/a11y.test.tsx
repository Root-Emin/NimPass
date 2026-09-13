import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { anOffer, aProvider, aService, mockApi, ok } from '@/test/mock-api'
import { renderApp, stubSession, stubWallet } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Accessibility checks that are cheap to keep true and expensive to retrofit
 * (milestone brief §20).
 */
describe('accessibility', () => {
  it('gives every public page exactly one h1 and semantic landmarks', async () => {
    mockApi({
      '/api/v1/public/packages': () => ok({ items: [anOffer()] }),
    })

    renderApp('/discover')
    await screen.findByText('10 Personal Training Sessions')

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('labels every icon-only control', async () => {
    mockApi({
      '/api/v1/public/packages': () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    renderApp('/discover')

    expect(await screen.findByRole('button', { name: 'Open menu' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Search services or providers'), 'x')
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })

  it('associates form labels, hints and errors with their control', async () => {
    mockApi({
      '/api/v1/providers': () => ok({ items: [aProvider()] }),
      '/api/v1/providers/00000000-0000-4000-8000-000000000002/services': () => ok({ items: [aService()] }),
      '/api/v1/providers/00000000-0000-4000-8000-000000000002/packages': () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    renderApp('/provider/packages/new', { wallet: stubWallet(), session: stubSession() })

    const sessions = await screen.findByLabelText('Number of sessions')
    expect(sessions).toBeInTheDocument()

    await user.type(sessions, '0')
    await user.type(screen.getByLabelText('Package name'), 'Block')
    await user.click(screen.getByRole('button', { name: 'Create package' }))

    const error = await screen.findByText('Enter a whole number of sessions, at least 1.')
    expect(sessions).toHaveAttribute('aria-invalid', 'true')
    expect(sessions.getAttribute('aria-describedby')).toContain(error.id)
  })

  it('traps the mobile menu in a labelled dialog that can be closed', async () => {
    mockApi({
      '/api/v1/public/packages': () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    renderApp('/discover')

    await user.click(await screen.findByRole('button', { name: 'Open menu' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Menu' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the hidden mobile purchase bar out of the tab order', async () => {
    mockApi({ [`/api/v1/public/packages/${anOffer().package.id}`]: () => ok(anOffer()) })

    const { container } = renderApp(`/packages/${anOffer().package.id}`)
    await screen.findByRole('heading', { level: 1 })

    // The bar is off screen until the panel scrolls away. It holds a real
    // button, so it is marked inert rather than aria-hidden — an aria-hidden
    // subtree containing a focusable control is a keyboard trap.
    const bar = container.querySelector('[inert]')
    expect(bar).not.toBeNull()
    expect(bar?.querySelector('button')).not.toBeNull()
  })
})

/**
 * Landmark and focus plumbing that is easy to break and hard to notice.
 */
describe('landmarks and skip navigation', () => {
  it('keeps hero content inside the main landmark', async () => {
    mockApi({
      '/api/v1/public/packages': () => ok({ items: [] }),
    })

    renderApp('/discover')

    const heading = await screen.findByRole('heading', { level: 1 })
    const main = screen.getByRole('main')

    // Discover renders its hero outside `<Page>`, so an implementation where
    // `Page` owned the landmark left the h1 — the page's whole subject —
    // outside it.
    expect(main).toContainElement(heading)
  })

  it('has exactly one main landmark', async () => {
    mockApi({
      '/api/v1/public/packages': () => ok({ items: [] }),
    })

    renderApp('/discover')
    await screen.findByRole('heading', { level: 1 })

    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('gives the skip link a target that can actually take focus', async () => {
    mockApi({
      '/api/v1/public/packages': () => ok({ items: [] }),
    })

    renderApp('/discover')

    const skip = await screen.findByRole('link', { name: 'Skip to content' })
    expect(skip).toHaveAttribute('href', '#main')

    // Without a tabindex the browser scrolls but leaves focus in the header,
    // which is the exact problem a skip link exists to solve.
    const target = document.getElementById('main')
    expect(target).not.toBeNull()
    expect(target).toHaveAttribute('tabindex', '-1')
  })
})
