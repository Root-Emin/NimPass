import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, mockApi, ok, offline } from '@/test/mock-api'
import { renderApp } from '@/test/render'
import type { PublicProvider } from '@/types/domain'

afterEach(() => {
  vi.unstubAllGlobals()
})

function aPublicProvider(overrides: Partial<PublicProvider> = {}): PublicProvider {
  return { ...aPublicPass().provider, ...overrides }
}

const ALEX = aPublicProvider()
const MIRA = aPublicProvider({
  id: '00000000-0000-4000-8000-000000000022',
  name: 'Mira Bendz',
  slug: 'mira-bendz',
  headline: 'German for work',
  location: 'Berlin',
})

const DIRECTORY = {
  items: [
    { provider: ALEX, passCount: 3 },
    { provider: MIRA, passCount: 1 },
  ],
}

/**
 * `/providers` — the whole directory, not a preview of it.
 *
 * Discover shows a few provider cards and hands the rest to this page. The
 * distinction matters because the preview used to be *all there was*, and it
 * was built in the browser out of the newest hundred public passes: a provider
 * whose passes fell off that page stopped being discoverable at all, with no
 * page anywhere that would list them.
 *
 * Everything below is therefore about one question — does this page show what
 * the backend says is discoverable, and does it behave when the answer is
 * nothing, or an error, or still coming.
 */
describe('the provider directory', () => {
  it('lists every provider the backend calls discoverable, with the counts it gave', async () => {
    const { calls } = mockApi({ '/api/v1/public/providers': () => ok(DIRECTORY) })

    renderApp('/providers')

    expect(await screen.findByRole('heading', { name: 'Providers', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Alex Fitness')).toBeInTheDocument()
    expect(screen.getByText('Mira Bendz')).toBeInTheDocument()
    expect(screen.getByText('2 providers')).toBeInTheDocument()

    // One request, to the endpoint that decides discoverability — not a scan of
    // the public pass catalogue.
    expect(calls.filter((call) => call.url === '/api/v1/public/providers')).toHaveLength(1)
    expect(calls.some((call) => call.url.startsWith('/api/v1/public/passes'))).toBe(false)

    // Counts are the backend's, and each card links by the stable slug.
    expect(screen.getByText('3 passes')).toBeInTheDocument()
    expect(screen.getByText('1 pass')).toBeInTheDocument()
    const links = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('/providers/'))
    expect(links).toEqual([`/providers/${ALEX.slug}`, `/providers/${MIRA.slug}`])
  })

  it('opens a provider from the directory', async () => {
    mockApi({
      '/api/v1/public/providers': () => ok(DIRECTORY),
      [`/api/v1/public/providers/by-slug/${MIRA.slug}`]: () => ok(MIRA),
      '/api/v1/public/passes': () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/providers')

    await user.click(await screen.findByRole('link', { name: /Mira Bendz/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/providers/${MIRA.slug}`))
    expect(await screen.findByRole('heading', { name: 'Mira Bendz', level: 1 })).toBeInTheDocument()
  })

  it('shows skeletons while the directory is loading, and never an empty list first', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockApi({
      '/api/v1/public/providers': async () => {
        await gate
        return ok(DIRECTORY)
      },
    })

    renderApp('/providers')

    await screen.findByRole('heading', { name: 'Providers', level: 1 })
    // "No providers yet" while the answer is still in flight would be a claim
    // the page cannot support (docs/08-ARCHITECTURE.md §11).
    expect(screen.queryByText('No providers yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Alex Fitness')).not.toBeInTheDocument()

    release!()
    expect(await screen.findByText('Alex Fitness')).toBeInTheDocument()
  })

  it('says so plainly when there is nobody to list', async () => {
    mockApi({ '/api/v1/public/providers': () => ok({ items: [] }) })

    renderApp('/providers')

    expect(await screen.findByText('No providers yet')).toBeInTheDocument()
  })

  it('reports an unreachable backend as an error with a retry, not as an empty directory', async () => {
    let attempts = 0
    mockApi({
      '/api/v1/public/providers': (url, init) => {
        attempts += 1
        if (attempts === 1) return offline()(url, init)
        return ok(DIRECTORY)
      },
    })

    const user = userEvent.setup()
    renderApp('/providers')

    // An outage must never read as "nobody sells on Nimpass".
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText('No providers yet')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Alex Fitness')).toBeInTheDocument()
  })

  it('narrows the directory it was given, keeping the search in the URL', async () => {
    mockApi({ '/api/v1/public/providers': () => ok(DIRECTORY) })

    const { router } = renderApp('/providers?q=mira')

    expect(await screen.findByText('Mira Bendz')).toBeInTheDocument()
    expect(screen.queryByText('Alex Fitness')).not.toBeInTheDocument()
    // The search lives in the URL, so a filtered view is shareable and survives
    // a refresh (docs/08-ARCHITECTURE.md §80).
    expect(router.state.location.search).toBe('?q=mira')
  })

  it('offers the way back when a search matches nobody', async () => {
    mockApi({ '/api/v1/public/providers': () => ok(DIRECTORY) })

    const user = userEvent.setup()
    const { router } = renderApp('/providers?q=nobody-by-this-name')

    expect(await screen.findByText('No providers matched')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show every provider' }))

    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(await screen.findByText('Alex Fitness')).toBeInTheDocument()
  })
})
