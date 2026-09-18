import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, domainError, mockApi, ok } from '@/test/mock-api'
import { renderApp } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const OFFER = aPublicPass()
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'

describe('Provider profile', () => {
  it('opens directly from a deep link and shows the storefront', async () => {
    mockApi({
      [`/api/v1/public/providers/${PROVIDER_ID}`]: () => ok(OFFER.provider),
      '/api/v1/public/passes': () => ok({ items: [OFFER] }),
    })

    renderApp(`/providers/${PROVIDER_ID}`)

    expect(
      await screen.findByRole('heading', { name: 'Alex Fitness', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument()

    // Passes are reachable from the profile.
    expect(
      await screen.findByRole('link', { name: /10 Personal Training Sessions/ }),
    ).toHaveAttribute('href', `/pass/${OFFER.pass.id}`)
  })

  it('never puts the payout wallet address on the public page', async () => {
    mockApi({
      [`/api/v1/public/providers/${PROVIDER_ID}`]: () => ok(OFFER.provider),
      '/api/v1/public/passes': () => ok({ items: [] }),
    })

    const { container } = renderApp(`/providers/${PROVIDER_ID}`)
    await screen.findByRole('heading', { name: 'Alex Fitness', level: 1 })

    // docs/03-DESIGN-SYSTEM.md §92 / docs/09-SECURITY.md §79.
    expect(container.textContent).not.toMatch(/NQ[0-9A-Z]/)
  })

  it('shows an empty state when the provider has published nothing', async () => {
    mockApi({
      [`/api/v1/public/providers/${PROVIDER_ID}`]: () => ok(OFFER.provider),
      '/api/v1/public/passes': () => ok({ items: [] }),
    })

    renderApp(`/providers/${PROVIDER_ID}`)

    expect(await screen.findByText('No passes available')).toBeInTheDocument()
  })

  it('reports an unknown provider as a domain error, not a network failure', async () => {
    mockApi({
      '/api/v1/public/providers/00000000-0000-4000-8000-0000000000ff': () =>
        domainError(404, 'NOT_FOUND', 'no such provider'),
      '/api/v1/public/passes': () => ok({ items: [] }),
    })

    renderApp('/providers/00000000-0000-4000-8000-0000000000ff')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("We couldn't find that.")
    // Retrying a 404 cannot help, so no retry is offered.
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('resolves a shared slug link through the contract slug endpoint', async () => {
    // Public links carry the slug because it survives a rename. The id route
    // still exists for the pass page, which holds an id and no slug.
    const { calls } = mockApi({
      [`/api/v1/public/providers/by-slug/${OFFER.provider.slug}`]: () => ok(OFFER.provider),
      '/api/v1/public/passes': () => ok({ items: [OFFER] }),
    })

    renderApp(`/providers/${OFFER.provider.slug}`)

    expect(
      await screen.findByRole('heading', { name: 'Alex Fitness', level: 1 }),
    ).toBeInTheDocument()
    // The slug was never sent to the id route, which would be a 404 or worse.
    expect(calls.some((call) => call.url === `/api/v1/public/providers/${PROVIDER_ID}`)).toBe(
      false,
    )
  })

  it('shows the profile the provider wrote, and nothing it did not', async () => {
    mockApi({
      [`/api/v1/public/providers/by-slug/${OFFER.provider.slug}`]: () =>
        ok({
          ...OFFER.provider,
          headline: 'Strength coaching in Kadıköy',
          bio: 'Ten years of one-to-one training.',
          location: 'Istanbul',
          avatarUrl: '',
        }),
      '/api/v1/public/passes': () => ok({ items: [OFFER] }),
    })

    renderApp(`/providers/${OFFER.provider.slug}`)

    expect(await screen.findByText('Strength coaching in Kadıköy')).toBeInTheDocument()
    expect(screen.getByText('Ten years of one-to-one training.')).toBeInTheDocument()
    expect(screen.getByText('Istanbul')).toBeInTheDocument()
    // No uploaded photograph — the identicon is the face.
    expect(document.querySelector('img[src^="http"]')).toBeNull()
  })

  it('renders only the fields that were filled in', async () => {
    // Empty strings are the contract's "not set". A placeholder headline would
    // be the page inventing a claim on the provider's behalf.
    mockApi({
      [`/api/v1/public/providers/by-slug/${OFFER.provider.slug}`]: () =>
        ok({
          id: OFFER.provider.id,
          name: 'Alex Fitness',
          slug: OFFER.provider.slug,
          headline: '',
          bio: '',
          avatarUrl: '',
          location: '',
          wallet: OFFER.provider.wallet,
        }),
      '/api/v1/public/passes': () => ok({ items: [] }),
    })

    renderApp(`/providers/${OFFER.provider.slug}`)

    await screen.findByRole('heading', { name: 'Alex Fitness', level: 1 })
    // The generic line stands in for a headline; nothing pretends to be a bio.
    expect(screen.getByText('Sessions you can buy and use over time.')).toBeInTheDocument()
    expect(screen.queryByText('Istanbul')).not.toBeInTheDocument()
  })
})
