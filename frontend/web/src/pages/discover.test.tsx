import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, aPass, mockApi, ok, offline } from '@/test/mock-api'
import { renderApp, stubSession } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const OFFERS = [
  aPublicPass(),
  aPublicPass({
    pass: aPass({
      id: '00000000-0000-4000-8000-000000000044',
      title: '12 German Conversation Hours',
      sessions: 12,
      priceLuna: 30_000_000,
      providerId: '00000000-0000-4000-8000-000000000022',
      serviceId: '00000000-0000-4000-8000-000000000033',
    }),
    provider: {
      id: '00000000-0000-4000-8000-000000000022',
      name: 'Mira Bendz',
      slug: 'mira-bendz',
      headline: 'German for work',
      bio: 'Conversation-first lessons.',
      avatarUrl: '',
      avatarVariant: 0,
      location: 'Berlin',
      wallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0022',
    },
    service: {
      id: '00000000-0000-4000-8000-000000000033',
      name: 'German Conversation',
      description: 'Spoken practice.',
      category: 'languages',
    },
  }),
]

describe('Discover', () => {
  it('shows skeletons before results arrive, then the Passes', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    mockApi({
      '/api/v1/public/passes': async () => {
        await gate
        return ok({ items: OFFERS })
      },
    })

    renderApp('/discover')

    // Loading: the grid is rendered as skeletons, with no pass content yet.
    expect(screen.queryByText('10 Personal Training Sessions')).not.toBeInTheDocument()

    release?.()

    expect(await screen.findByText('10 Personal Training Sessions')).toBeInTheDocument()
    expect(screen.getByText('12 German Conversation Hours')).toBeInTheDocument()
    expect(screen.getByText('250 NIM')).toBeInTheDocument()
  })

  it('distinguishes "nothing matched" from "backend unreachable"', async () => {
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [] }),
    })

    renderApp('/discover?q=zzzz')

    expect(await screen.findByText('Nothing matched')).toBeInTheDocument()
    // An empty result is not an error, so no alert is raised.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports an unreachable backend as an error with a retry', async () => {
    mockApi({
      '/api/v1/public/passes': offline(),
    })

    renderApp('/discover')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Can't reach Nimpass/i)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('restores search state from the URL on load', async () => {
    const { calls } = mockApi({
      '/api/v1/public/passes': () => ok({ items: [OFFERS[0]!] }),
    })

    renderApp('/discover?q=training')

    await screen.findByText('10 Personal Training Sessions')

    expect(screen.getByLabelText('Search passes or providers')).toHaveValue('training')
    // Filtering happens in the browser: the contract has no search parameter.
    expect(calls.some((call) => call.url === '/api/v1/public/passes')).toBe(true)
  })

  it('pushes the typed search into the URL so a refresh keeps it', async () => {
    mockApi({
      '/api/v1/public/passes': () => ok({ items: OFFERS }),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/discover')

    await screen.findByText('10 Personal Training Sessions')
    await user.type(screen.getByLabelText('Search passes or providers'), 'german')

    await waitFor(() => expect(router.state.location.search).toContain('q=german'), {
      timeout: 3000,
    })
  })


  it('previews the provider directory and offers the way to all of it', async () => {
    // The rail is `GET /public/providers`, not a by-product of the passes on
    // screen: a provider whose passes fall off the newest hundred used to
    // disappear from Discover entirely.
    const { calls } = mockApi({
      '/api/v1/public/passes': () => ok({ items: OFFERS }),
      '/api/v1/public/providers': () =>
        ok({
          items: OFFERS.map((offer, index) => ({ provider: offer.provider, passCount: index + 3 })),
        }),
    })

    renderApp('/discover')

    await screen.findByText('10 Personal Training Sessions')
    expect(await screen.findByRole('heading', { name: 'Explore providers' })).toBeInTheDocument()

    expect(calls.some((call) => call.url === '/api/v1/public/providers')).toBe(true)

    // The rail's own links, and the counts the backend reported — not a tally
    // of how many of each provider's passes happened to be on this page.
    const railLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/providers'))
    expect(railLinks.map((link) => link.getAttribute('href'))).toEqual(
      expect.arrayContaining([
        `/providers/${OFFERS[0]!.provider.slug}`,
        `/providers/${OFFERS[1]!.provider.slug}`,
        '/providers',
      ]),
    )
    expect(await screen.findByText('3 passes')).toBeInTheDocument()
    expect(await screen.findByText('4 passes')).toBeInTheDocument()
  })

  it('sends "See all providers" to the full directory', async () => {
    mockApi({
      '/api/v1/public/passes': () => ok({ items: OFFERS }),
      '/api/v1/public/providers': () =>
        ok({ items: OFFERS.map((offer) => ({ provider: offer.provider, passCount: 1 })) }),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/discover')

    await user.click(await screen.findByRole('link', { name: /See all providers/i }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/providers'))
    expect(await screen.findByRole('heading', { name: 'Providers', level: 1 })).toBeInTheDocument()
  })

  it('filters by category on the backend, using only the taxonomy it was given', async () => {
    // The category is a server-side selection, not a slice of one response:
    // an invented value is a VALIDATION_ERROR on this endpoint.
    const { calls } = mockApi({
      '/api/v1/public/categories': () => ok({ items: ['fitness', 'languages'] }),
      '/api/v1/public/passes': (url) =>
        ok({
          items:
            url.searchParams.get('category') === 'languages' ? [OFFERS[1]!] : OFFERS,
        }),
    })

    const user = userEvent.setup()
    renderApp('/discover')

    expect(await screen.findByText('10 Personal Training Sessions')).toBeInTheDocument()

    await user.click(await screen.findByRole('radio', { name: 'Languages' }))

    await waitFor(() =>
      expect(screen.queryByText('10 Personal Training Sessions')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('12 German Conversation Hours')).toBeInTheDocument()
    expect(calls.some((call) => call.url === '/api/v1/public/passes?category=languages')).toBe(
      true,
    )
  })

  it('keeps the chosen category in the URL, and ignores one it was never offered', async () => {
    const { calls } = mockApi({
      '/api/v1/public/categories': () => ok({ items: ['fitness', 'languages'] }),
      '/api/v1/public/passes': () => ok({ items: OFFERS }),
    })

    const { router } = renderApp('/discover?category=not-a-category')

    await screen.findByText('10 Personal Training Sessions')
    // An unknown value never reaches the request.
    expect(calls.every((call) => !call.url.includes('category=not-a-category'))).toBe(true)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Fitness' }))

    await waitFor(() =>
      expect(router.state.location.search).toBe('?category=fitness'),
    )
  })
})

/**
 * Who published a pass is a relation the backend stores, so the card shows what
 * the payload says — the same creator to a visitor with no session, to another
 * customer, and to the creator themselves.
 *
 * The bug this pins down is a creator line derived from whoever is signed in:
 * it looks right to the one person who already knows, and is wrong on the
 * public screen it was written for (docs/DECISIONS.md ADR-010).
 */
describe('The creator on a pass card', () => {
  const CREATOR = {
    id: '00000000-0000-4000-8000-000000000091',
    name: 'Emin Kutlu',
    slug: 'emin-kutlu',
    headline: 'Software',
    bio: '',
    avatarUrl: 'https://example.test/emin.png',
    avatarVariant: 0,
    location: '',
    wallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0091',
  }

  const PUBLISHED = aPublicPass({
    pass: aPass({
      id: '00000000-0000-4000-8000-000000000092',
      title: 'Learn C++',
      providerId: CREATOR.id,
      serviceId: '00000000-0000-4000-8000-000000000093',
    }),
    provider: CREATOR,
    service: {
      id: '00000000-0000-4000-8000-000000000093',
      name: 'Software',
      description: 'Sessions.',
      category: 'tutoring',
    },
  })

  async function creatorLine(session: ReturnType<typeof stubSession> | null) {
    mockApi({ '/api/v1/public/passes': () => ok({ items: [PUBLISHED] }) })
    const view = renderApp('/discover', { session })
    const card = (await screen.findByText('Learn C++')).closest('a') as HTMLElement
    return { card, unmount: view.unmount }
  }

  // The creator's own account, for the "own pass" case.
  const creatorSession = stubSession({
    identity: { id: 'ffffffff-0000-4000-8000-000000000091', wallet: CREATOR.wallet, createdAt: '2026-01-01T00:00:00Z' },
  })

  it.each([
    ['logged out', null],
    ['signed in as another customer', stubSession()],
    ['signed in as the creator', creatorSession],
  ])('names the pass creator when %s', async (_case, session) => {
    const { card, unmount } = await creatorLine(session)

    expect(within(card).getByText('Emin Kutlu')).toBeInTheDocument()
    // The real avatar from the payload, not one derived from the pass. The
    // card also carries the cover and the wallet identicon, so this looks for
    // the provider's own photograph among them.
    const images = Array.from(card.querySelectorAll('img')).map((img) => img.getAttribute('src'))
    expect(images).toContain(CREATOR.avatarUrl)
    // Never a second-person placeholder, on anyone's screen.
    expect(within(card).queryByText(/your studio/i)).not.toBeInTheDocument()
    expect(within(card).queryByText(/^you$/i)).not.toBeInTheDocument()

    unmount()
  })
})

/**
 * The chosen face is public data like the name: it comes from the payload, so
 * a logged-out visitor sees the face the provider picked, not the default one.
 */
describe('The creator\'s face on a pass card', () => {
  const WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0091'

  function passWithFace(id: string, title: string, avatarVariant: number) {
    return aPublicPass({
      pass: aPass({ id, title, providerId: '00000000-0000-4000-8000-000000000091' }),
      provider: {
        id: '00000000-0000-4000-8000-000000000091',
        name: 'Emin Kutlu',
        slug: 'emin-kutlu',
        headline: '',
        bio: '',
        avatarUrl: '',
        avatarVariant,
        location: '',
        wallet: WALLET,
      },
    })
  }

  it('draws the identicon the provider chose, logged out', async () => {
    mockApi({
      '/api/v1/public/passes': () =>
        ok({
          items: [
            passWithFace('00000000-0000-4000-8000-000000000094', 'Default face', 0),
            passWithFace('00000000-0000-4000-8000-000000000095', 'Chosen face', 4),
          ],
        }),
    })

    renderApp('/discover', { session: null })

    const byDefault = (await screen.findByText('Default face')).closest('a') as HTMLElement
    const chosen = (await screen.findByText('Chosen face')).closest('a') as HTMLElement

    // Same wallet, two different stored choices, two different faces on screen.
    const face = async (card: HTMLElement) => {
      let src: string | null = null
      await waitFor(() => {
        src = card.querySelector('img')?.getAttribute('src') ?? null
        expect(src).toMatch(/^data:image\/svg\+xml/)
      })
      return src
    }
    expect(await face(chosen)).not.toBe(await face(byDefault))
  })
})
