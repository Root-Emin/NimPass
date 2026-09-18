import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPass, aProvider, aPublicPass, aService, domainError, mockApi, ok } from '@/test/mock-api'
import { renderApp, stubSession, stubWallet } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WALLET = stubWallet()
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'
const SERVICE_ID = '00000000-0000-4000-8000-000000000003'
const NEW_PROVIDER_ID = '00000000-0000-4000-8000-0000000000aa'
const CREATED_PASS_ID = 'ffffffff-0000-4000-8000-000000000001'

/**
 * A created Pass is published in the same press and opens on its public page,
 * so every create stubs the two routes that happen after the write.
 */
const PUBLISH_ROUTES = {
  [`POST /api/v1/catalog/passes/${CREATED_PASS_ID}/publish`]: () =>
    ok(aPass({ id: CREATED_PASS_ID, status: 'ACTIVE' })),
  [`/api/v1/public/passes/${CREATED_PASS_ID}`]: () =>
    ok(aPublicPass({ pass: aPass({ id: CREATED_PASS_ID, status: 'ACTIVE' }) })),
}

/** A signed-in wallet that has never sold anything: no provider record at all. */
const NO_PROVIDER = { '/api/v1/providers': () => ok({ items: [] }) }

async function confirmCreate(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Create Pass' }))
}

/**
 * Authentication and provider authorisation are separate questions
 * (docs/09-SECURITY.md §67-§68), and the selling side has to answer both
 * without ever turning the second one into a setup screen
 * (docs/DECISIONS.md ADR-020).
 *
 * The failure these pin down is specific: every provider-scoped query is keyed
 * on a provider id, so an identity that owns none must still get an *answer* —
 * a disabled react-query query reports `isPending` forever, which renders as a
 * skeleton that never resolves.
 */
describe('a wallet that owns no provider record', () => {
  it('opens straight into the Pass form instead of a setup step', async () => {
    mockApi(NO_PROVIDER)

    renderApp('/provider/passes/new', { wallet: WALLET, session: stubSession() })

    // The first thing on screen is the pass, not a workspace to create first.
    expect(await screen.findByLabelText('Pass name')).toBeInTheDocument()
    expect(screen.queryByText('Set up your workspace')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create workspace' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument()

    // One extra row, because the record the pass needs has to be named.
    expect(screen.getByRole('textbox', { name: /Your store name/i })).toBeInTheDocument()
  })

  it('shows an empty store rather than an interstitial', async () => {
    mockApi(NO_PROVIDER)

    renderApp('/my-store', { wallet: WALLET, session: stubSession() })

    expect(await screen.findByText('No passes yet')).toBeInTheDocument()
    expect(screen.queryByText('Set up your workspace')).not.toBeInTheDocument()
    // Nothing is claimed about sales for an account that has made none.
    expect(screen.queryByText('Sold passes')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('creates the provider, the service and the pass in that order on a first sale', async () => {
    const { calls } = mockApi({
      ...NO_PROVIDER,
      'POST /api/v1/providers': () => ok(aProvider({ id: NEW_PROVIDER_ID }), 201),
      [`POST /api/v1/providers/${NEW_PROVIDER_ID}/services`]: () =>
        ok(aService({ id: SERVICE_ID, providerId: NEW_PROVIDER_ID }), 201),
      [`PATCH /api/v1/services/${SERVICE_ID}`]: () =>
        ok(aService({ id: SERVICE_ID, providerId: NEW_PROVIDER_ID, status: 'ACTIVE' })),
      [`POST /api/v1/providers/${NEW_PROVIDER_ID}/services/${SERVICE_ID}/passes`]: () =>
        ok(aPass({ id: CREATED_PASS_ID, status: 'DRAFT' }), 201),
      ...PUBLISH_ROUTES,
    })

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: stubSession() })

    await user.type(await screen.findByLabelText('Pass name'), '10 Guitar Lessons')
    await user.type(screen.getByRole('textbox', { name: /Your store name/i }), 'Alex Fitness')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    await confirmCreate(user)

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/passes'))).toBe(true),
    )

    // `ProviderInput` takes the name; the slug is the backend's to generate
    // (docs/DECISIONS.md ADR-017), so the form never sends one.
    const provider = calls.find((c) => c.method === 'POST' && c.url === '/api/v1/providers')
    expect(provider?.body).toEqual({ name: 'Alex Fitness' })

    // And every later write goes to the id that call returned — not to a stale
    // one from a profile query that has not come back yet.
    const service = calls.find((c) => c.method === 'POST' && c.url.endsWith('/services'))
    expect(service?.url).toBe(`/api/v1/providers/${NEW_PROVIDER_ID}/services`)
    const pass = calls.find((c) => c.method === 'POST' && c.url.endsWith('/passes'))
    expect(pass?.url).toBe(
      `/api/v1/providers/${NEW_PROVIDER_ID}/services/${SERVICE_ID}/passes`,
    )
    expect(calls.every((call) => !call.url.includes('undefined'))).toBe(true)
  })

  it('will not write anything when the store name is missing', async () => {
    const { calls } = mockApi(NO_PROVIDER)

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: stubSession() })

    await user.type(await screen.findByLabelText('Pass name'), '10 Guitar Lessons')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))

    expect(
      await screen.findByText('Tell customers who they are buying from.'),
    ).toBeInTheDocument()
    // `providers_name_nonempty` would reject it anyway; the point is that the
    // draft never reaches the confirmation step, let alone the network.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('reports a rejected provider write instead of pretending the Pass was made', async () => {
    const { calls } = mockApi({
      ...NO_PROVIDER,
      'POST /api/v1/providers': () => domainError(409, 'CONFLICT'),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/provider/passes/new', {
      wallet: WALLET,
      session: stubSession(),
    })

    await user.type(await screen.findByLabelText('Pass name'), '10 Guitar Lessons')
    await user.type(screen.getByRole('textbox', { name: /Your store name/i }), 'Alex Fitness')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    await confirmCreate(user)

    expect(await screen.findByText("Couldn't create this Pass")).toBeInTheDocument()
    // Nothing downstream was attempted, and the form kept everything typed.
    expect(calls.some((c) => c.url.endsWith('/services') && c.method === 'POST')).toBe(false)
    expect(calls.some((c) => c.url.endsWith('/passes') && c.method === 'POST')).toBe(false)
    expect(router.state.location.pathname).toBe('/provider/passes/new')
  })
})

describe('a wallet that already owns one', () => {
  const EXISTING = {
    '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
    [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
    [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
  }

  it('is never asked to name a store again', async () => {
    mockApi(EXISTING)

    renderApp('/provider/passes/new', { wallet: WALLET, session: stubSession() })

    expect(await screen.findByLabelText('Pass name')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Your store name/i })).not.toBeInTheDocument()
  })

  it('creates no second provider record when it makes a pass', async () => {
    const { calls } = mockApi({
      ...EXISTING,
      [`POST /api/v1/providers/${PROVIDER_ID}/services`]: () => ok(aService({ id: SERVICE_ID }), 201),
      [`PATCH /api/v1/services/${SERVICE_ID}`]: () =>
        ok(aService({ id: SERVICE_ID, status: 'ACTIVE' })),
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/passes`]: () =>
        ok(aPass({ id: CREATED_PASS_ID, status: 'DRAFT' }), 201),
      ...PUBLISH_ROUTES,
    })

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: stubSession() })

    await user.type(await screen.findByLabelText('Pass name'), '10 Guitar Lessons')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    await confirmCreate(user)

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/passes'))).toBe(true),
    )
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/providers')).toBe(false)
  })

  it('loads the store from the provider record the backend returns', async () => {
    // The session carries no provider id at all — the provider list is the
    // authority on which providers this identity owns.
    mockApi(EXISTING)

    renderApp('/provider', { wallet: WALLET, session: stubSession() })

    expect(await screen.findByRole('heading', { name: 'My Store', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('No passes yet')).toBeInTheDocument()
  })

  it('scopes provider reads to the id the backend reported, not one the client picked', async () => {
    const { calls } = mockApi(EXISTING)

    renderApp('/provider', { wallet: WALLET, session: stubSession() })

    await screen.findByText('No passes yet')

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes(`/providers/${PROVIDER_ID}/passes`))).toBe(
        true,
      ),
    )
    expect(calls.every((call) => !call.url.includes('undefined'))).toBe(true)
  })
})
