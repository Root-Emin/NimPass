import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { anOffer, domainError, mockApi, ok } from '@/test/mock-api'
import { renderApp } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const OFFER = anOffer()
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'

describe('Provider profile', () => {
  it('opens directly from a deep link and shows the storefront', async () => {
    mockApi({
      [`/api/v1/public/providers/${PROVIDER_ID}`]: () => ok(OFFER.provider),
      '/api/v1/public/packages': () => ok({ items: [OFFER] }),
    })

    renderApp(`/providers/${PROVIDER_ID}`)

    expect(
      await screen.findByRole('heading', { name: 'Alex Fitness', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument()

    // Packages are reachable from the profile.
    expect(
      await screen.findByRole('link', { name: /10 Personal Training Sessions/ }),
    ).toHaveAttribute('href', `/packages/${OFFER.package.id}`)
  })

  it('never puts the payout wallet address on the public page', async () => {
    mockApi({
      [`/api/v1/public/providers/${PROVIDER_ID}`]: () => ok(OFFER.provider),
      '/api/v1/public/packages': () => ok({ items: [] }),
    })

    const { container } = renderApp(`/providers/${PROVIDER_ID}`)
    await screen.findByRole('heading', { name: 'Alex Fitness', level: 1 })

    // docs/03-DESIGN-SYSTEM.md §92 / docs/09-SECURITY.md §79.
    expect(container.textContent).not.toMatch(/NQ[0-9A-Z]/)
  })

  it('shows an empty state when the provider has published nothing', async () => {
    mockApi({
      [`/api/v1/public/providers/${PROVIDER_ID}`]: () => ok(OFFER.provider),
      '/api/v1/public/packages': () => ok({ items: [] }),
    })

    renderApp(`/providers/${PROVIDER_ID}`)

    expect(await screen.findByText('No packages available')).toBeInTheDocument()
  })

  it('reports an unknown provider as a domain error, not a network failure', async () => {
    mockApi({
      '/api/v1/public/providers/00000000-0000-4000-8000-0000000000ff': () =>
        domainError(404, 'NOT_FOUND', 'no such provider'),
      '/api/v1/public/packages': () => ok({ items: [] }),
    })

    renderApp('/providers/00000000-0000-4000-8000-0000000000ff')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("We couldn't find that.")
    // Retrying a 404 cannot help, so no retry is offered.
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
