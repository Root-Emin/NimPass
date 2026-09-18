import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aProvider, aService, domainError, mockApi, ok, offline } from '@/test/mock-api'
import { renderApp, stubSession, stubWallet } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WALLET = stubWallet()
// An authenticated Nimpass session: the workspace gates on the backend session,
// not on an address Nimiq Pay happened to reveal (docs/09-SECURITY.md §11).
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'
const SERVICE_ID = '00000000-0000-4000-8000-000000000003'
const SESSION = stubSession()

const EMPTY_WORKSPACE = {
  '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
  '/api/v1/providers/00000000-0000-4000-8000-000000000002/services': () => ok({ items: [] }),
  '/api/v1/providers/00000000-0000-4000-8000-000000000002/passes': () => ok({ items: [] }),
}

/**
 * The confirmation step every create now passes through.
 *
 * Pressing Create Pass opens a preview instead of writing anything; this is the
 * press inside it. Scoped to the dialog, because the form's own button is still
 * on the page behind it.
 */
async function confirmCreate(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Create Pass' }))
}

describe('Selling surface', () => {
  it('has no workspace shell, sidebar or sections to move between', async () => {
    mockApi(EMPTY_WORKSPACE)

    const { router } = renderApp('/provider', { wallet: WALLET, session: SESSION })

    expect(await screen.findByRole('heading', { name: 'My Store', level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/my-store')

    // The things a workspace was made of, and none of them are here.
    expect(screen.queryByRole('navigation', { name: 'Provider workspace' })).not.toBeInTheDocument()
    for (const gone of ['Services', 'Redeem', 'View public profile']) {
      expect(screen.queryByRole('link', { name: gone }), `${gone} is still navigable`).toBeNull()
    }
  })

  it('lands on what the provider sells, with no invented metrics', async () => {
    mockApi(EMPTY_WORKSPACE)

    renderApp('/provider', { wallet: WALLET, session: SESSION })

    // There is no dashboard: `/provider` is My Store, and an empty store says
    // so rather than reporting zeroes at it.
    expect(await screen.findByRole('heading', { name: 'My Store', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('No passes yet')).toBeInTheDocument()

    // No fabricated business metrics anywhere on the page (brief §13).
    const text = document.body.textContent ?? ''
    for (const forbidden of [
      'Revenue',
      'NIM Received',
      'NIM received',
      'Passes Sold',
      'Sessions This Month',
      'Total customers',
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('asks for sign-in instead of showing empty provider data', async () => {
    mockApi(EMPTY_WORKSPACE)

    renderApp('/provider', { wallet: WALLET, session: null })

    expect(await screen.findByText('Log in to manage your workspace')).toBeInTheDocument()
    expect(screen.queryByText('No passes yet')).not.toBeInTheDocument()
  })

  it('surfaces an unreachable backend rather than an empty workspace', async () => {
    mockApi({
      '/api/v1/providers': offline(),
      '/api/v1/providers/00000000-0000-4000-8000-000000000002/services': offline(),
      '/api/v1/providers/00000000-0000-4000-8000-000000000002/passes': offline(),
    })

    renderApp('/provider', { wallet: WALLET, session: SESSION })

    expect(await screen.findByRole('alert')).toHaveTextContent(/Can't reach Nimpass/i)
  })
})

describe('The service a pass belongs to', () => {
  const SERVICES_URL = `/api/v1/providers/${PROVIDER_ID}/services`

  it('derives it from the pass name, creating and activating it in order', async () => {
    // Two writes the provider never sees, and is never asked about: a pass is
    // created under a service, a created service is a DRAFT (`ServiceInput` has
    // no status), and publishing requires an ACTIVE one. The form takes the
    // pass's own name for it.
    const { calls } = mockApi({
      ...EMPTY_WORKSPACE,
      [`POST ${SERVICES_URL}`]: () => ok(aService({ id: SERVICE_ID }), 201),
      [`PATCH /api/v1/services/${SERVICE_ID}`]: () =>
        ok(aService({ id: SERVICE_ID, status: 'ACTIVE' })),
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/passes`]: () =>
        ok({ id: 'ffffffff-0000-4000-8000-000000000001' }, 201),
    })

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await user.type(await screen.findByLabelText('Pass name'), '10 Guitar Lessons')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    await confirmCreate(user)

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/passes') && c.method === 'POST')).toBe(true),
    )

    const created = calls.find((c) => c.url === SERVICES_URL && c.method === 'POST')
    // `ServiceInput` is `{ name, description?, category? }`,
    // `additionalProperties:false`. No category, because the form no longer has
    // one to collect — '' is the contract's unclassified value.
    expect(created?.body).toEqual({ name: '10 Guitar Lessons', category: '' })

    // Then ACTIVE, because publishing will need it.
    const activated = calls.find((c) => c.method === 'PATCH')
    expect(activated?.url).toBe(`/api/v1/services/${SERVICE_ID}`)
    expect(activated?.body).toMatchObject({ status: 'ACTIVE' })

    // And the pass lands under the service that was just made.
    const pass = calls.find((c) => c.url.endsWith('/passes') && c.method === 'POST')
    expect(pass?.url).toContain(`/services/${SERVICE_ID}/passes`)
  })

  it('reuses a service of the same name instead of making a second one', async () => {
    const { calls } = mockApi({
      ...EMPTY_WORKSPACE,
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () =>
        ok({ items: [aService({ id: SERVICE_ID, name: 'Guitar Lessons', status: 'ACTIVE' })] }),
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/passes`]: () => ok({}, 201),
    })

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await user.type(await screen.findByLabelText('Pass name'), 'guitar lessons')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    await confirmCreate(user)

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/passes') && c.method === 'POST')).toBe(true),
    )
    // Nothing was created, and the ACTIVE service was not touched.
    expect(calls.some((c) => c.url === SERVICES_URL && c.method === 'POST')).toBe(false)
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('reports a rejected service write instead of pretending the pass was made', async () => {
    const { calls } = mockApi({
      ...EMPTY_WORKSPACE,
      [`POST ${SERVICES_URL}`]: () => domainError(401, 'AUTH_REQUIRED'),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await user.type(await screen.findByLabelText('Pass name'), '10 Sessions')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    await confirmCreate(user)

    expect(await screen.findByText("Couldn't create this Pass")).toBeInTheDocument()
    expect(
      screen.getByText('Your session has ended. Log in again to continue.'),
    ).toBeInTheDocument()
    // The pass write never happened, and the form stayed where it was.
    expect(calls.some((c) => c.url.endsWith('/passes') && c.method === 'POST')).toBe(false)
    expect(router.state.location.pathname).toBe('/provider/passes/new')
  })
})

describe('Pass form', () => {
  /*
   * A provider who has sold something before. The service write routes are
   * stubbed too: a Pass derives its own service from its name, so a name that
   * matches nothing they have sold creates one before the pass is written.
   */
  const WITH_SERVICE = {
    ...EMPTY_WORKSPACE,
    '/api/v1/providers/00000000-0000-4000-8000-000000000002/services': () =>
      ok({ items: [aService()] }),
    [`POST /api/v1/providers/${PROVIDER_ID}/services`]: () => ok(aService({ id: SERVICE_ID }), 201),
    [`PATCH /api/v1/services/${SERVICE_ID}`]: () =>
      ok(aService({ id: SERVICE_ID, status: 'ACTIVE' })),
  }

  it('opens straight into the form when the provider has nothing yet', async () => {
    mockApi(EMPTY_WORKSPACE)

    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    // No interstitial, no setup screen, and nothing to answer before the pass
    // itself: the first thing on screen is what it is called.
    expect(await screen.findByLabelText('Pass name')).toBeInTheDocument()
    expect(screen.queryByText(/Add a service first/i)).not.toBeInTheDocument()
  })

  it('rejects fractional sessions and non-positive prices', async () => {
    const { calls } = mockApi(WITH_SERVICE)

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await user.type(await screen.findByLabelText('Pass name'), '10 Sessions')
    await user.type(screen.getByLabelText('Number of sessions'), '7.4')
    await user.type(screen.getByLabelText('Price'), '0')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))

    // Sessions are integers (docs/08-ARCHITECTURE.md §76).
    expect(
      await screen.findByText('Enter a whole number of sessions, at least 1.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Enter a price in NIM.')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    // An invalid draft never reaches the confirmation step either.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('converts the NIM price to integer Luna before sending it', async () => {
    const { calls } = mockApi({
      ...WITH_SERVICE,
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/passes`]: () => ok({}, 201),
    })

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await user.type(await screen.findByLabelText('Pass name'), '10 Personal Training Sessions')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    await confirmCreate(user)

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/passes'))).toBe(true),
    )

    // The service write comes first, so the pass is the POST that ends in
    // `/passes` rather than simply the first one.
    const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/passes'))
    // The service is in the path (`/providers/{id}/services/{serviceId}/passes`),
    // so the body carries only the pass itself.
    expect(post?.url).toContain(`/services/${SERVICE_ID}/passes`)
    // `PassInput` names them `sessions` and `expirationAt`.
    expect(post?.body).toMatchObject({
      sessions: 10,
      priceLuna: 25_000_000,
      expirationAt: null,
    })
    // Never a float NIM amount on the wire (docs/05 §6-9).
    const body = post!.body as { priceLuna: number }
    expect(body.priceLuna % 1).toBe(0)
  })

  it('keeps the description folded away until the provider asks for it', async () => {
    const { calls } = mockApi({
      ...WITH_SERVICE,
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/passes`]: () => ok({}, 201),
    })

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    // An empty textarea is not on the page until it is wanted — the form reads
    // as short, and the optional field is one click away.
    expect(await screen.findByRole('button', { name: /Add description/ })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Description/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Add description/ }))
    await user.type(screen.getByRole('textbox', { name: /Description/ }), 'Two sessions a week.')

    await user.type(screen.getByLabelText('Pass name'), '10 Sessions')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    await confirmCreate(user)

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/passes'))).toBe(true),
    )
    expect(
      calls.find((call) => call.method === 'POST' && call.url.endsWith('/passes'))?.body,
    ).toMatchObject({ description: 'Two sessions a week.' })
  })

  it('composes the creation screen cover-first, with theme then name', async () => {
    mockApi(WITH_SERVICE)

    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    const theme = await screen.findByText('Theme')
    const name = screen.getByLabelText('Pass name')
    const create = screen.getByRole('button', { name: 'Create Pass' })

    expect(theme.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(name.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument()
    expect(screen.getByText('Starts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose end date' })).toBeInTheDocument()
    expect(screen.getByText('Pass options')).toBeInTheDocument()
    // Nothing about drafts, and nothing about clocks.
    expect(screen.queryByText(/Draft/i)).not.toBeInTheDocument()
    expect(screen.queryByText('UTC')).not.toBeInTheDocument()
  })

  it('shuffles the pass colour to another legal token', async () => {
    mockApi(WITH_SERVICE)

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    const before = (await screen.findAllByRole('radio')).find(
      (radio) => radio.getAttribute('aria-checked') === 'true',
    )
    expect(before).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Shuffle pass colour' }))

    const radios = screen.getAllByRole('radio')
    const after = radios.filter((radio) => radio.getAttribute('aria-checked') === 'true')
    // Exactly one choice, and never a seventh colour the contract would reject.
    expect(after).toHaveLength(1)
    expect(after[0]).not.toBe(before)
    expect(radios).toHaveLength(6)
  })

  it('shows the derived per-session price as the provider types', async () => {
    mockApi(WITH_SERVICE)

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await user.type(await screen.findByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')

    // The derived figure is held in its own panel beside the two fields that
    // produce it, rather than as a hint under the price.
    const panel = (await screen.findByText('Per session')).closest('aside')
    expect(panel).not.toBeNull()
    expect(within(panel!).getByText('25 NIM')).toBeInTheDocument()
  })
})
