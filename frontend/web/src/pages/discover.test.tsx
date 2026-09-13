import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { anOffer, aPackage, mockApi, ok, offline } from '@/test/mock-api'
import { renderApp } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const OFFERS = [
  anOffer(),
  anOffer({
    package: aPackage({
      id: '00000000-0000-4000-8000-000000000044',
      title: '12 German Conversation Hours',
      sessions: 12,
      priceLuna: 30_000_000,
      providerId: '00000000-0000-4000-8000-000000000022',
      serviceId: '00000000-0000-4000-8000-000000000033',
    }),
    provider: { id: '00000000-0000-4000-8000-000000000022', name: 'Mira Bendz' },
    service: {
      id: '00000000-0000-4000-8000-000000000033',
      name: 'German Conversation',
      description: 'Spoken practice.',
    },
  }),
]

describe('Discover', () => {
  it('shows skeletons before results arrive, then the packages', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    mockApi({
      '/api/v1/public/packages': async () => {
        await gate
        return ok({ items: OFFERS })
      },
    })

    renderApp('/discover')

    // Loading: the grid is rendered as skeletons, with no package content yet.
    expect(screen.queryByText('10 Personal Training Sessions')).not.toBeInTheDocument()

    release?.()

    expect(await screen.findByText('10 Personal Training Sessions')).toBeInTheDocument()
    expect(screen.getByText('12 German Conversation Hours')).toBeInTheDocument()
    expect(screen.getByText('250 NIM')).toBeInTheDocument()
  })

  it('distinguishes "nothing matched" from "backend unreachable"', async () => {
    mockApi({
      '/api/v1/public/packages': () => ok({ items: [] }),
    })

    renderApp('/discover?q=zzzz')

    expect(await screen.findByText('Nothing matched your search')).toBeInTheDocument()
    // An empty result is not an error, so no alert is raised.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports an unreachable backend as an error with a retry', async () => {
    mockApi({
      '/api/v1/public/packages': offline(),
    })

    renderApp('/discover')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Can't reach Nimpass/i)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('restores search state from the URL on load', async () => {
    const { calls } = mockApi({
      '/api/v1/public/packages': () => ok({ items: [OFFERS[0]!] }),
    })

    renderApp('/discover?q=training')

    await screen.findByText('10 Personal Training Sessions')

    expect(screen.getByLabelText('Search services or providers')).toHaveValue('training')
    // Filtering happens in the browser: the contract has no search parameter.
    expect(calls.some((call) => call.url === '/api/v1/public/packages')).toBe(true)
  })

  it('pushes the typed search into the URL so a refresh keeps it', async () => {
    mockApi({
      '/api/v1/public/packages': () => ok({ items: OFFERS }),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/discover')

    await screen.findByText('10 Personal Training Sessions')
    await user.type(screen.getByLabelText('Search services or providers'), 'german')

    await waitFor(() => expect(router.state.location.search).toContain('q=german'), {
      timeout: 3000,
    })
  })


  it('lists providers derived from the published packages', async () => {
    // There is no public provider list in the contract, so the rail is built
    // from the offers already on screen.
    mockApi({ '/api/v1/public/packages': () => ok({ items: OFFERS }) })

    renderApp('/discover')

    await screen.findByText('10 Personal Training Sessions')

    // The name appears on the package card too, so assert the rail's own link.
    expect(await screen.findByRole('heading', { name: 'Explore providers' })).toBeInTheDocument()
    const railLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/providers/'))
    expect(railLinks.length).toBe(2)
  })
})
