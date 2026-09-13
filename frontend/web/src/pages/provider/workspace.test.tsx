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
  '/api/v1/providers/00000000-0000-4000-8000-000000000002/packages': () => ok({ items: [] }),
}

describe('Provider workspace navigation', () => {
  it('renders the workspace nav and moves between sections', async () => {
    mockApi({
      ...EMPTY_WORKSPACE,
      '/api/v1/providers/00000000-0000-4000-8000-000000000002/passes': () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/provider', { wallet: WALLET, session: SESSION })

    const nav = await screen.findByRole('navigation', { name: 'Provider workspace' })
    await user.click(within(nav).getByRole('link', { name: 'Packages' }))

    expect(await screen.findByRole('heading', { name: 'Packages', level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/provider/packages')
  })

  it('shows setup steps derived from real data, and no invented metrics', async () => {
    mockApi(EMPTY_WORKSPACE)

    renderApp('/provider', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('Add a service')).toBeInTheDocument()
    expect(screen.getByText('Create a package')).toBeInTheDocument()

    // Counts are real query results, so an empty workspace reads as zero.
    const counts = screen.getAllByText('0')
    expect(counts.length).toBeGreaterThanOrEqual(3)

    // No fabricated business metrics anywhere on the page (brief §13).
    const text = document.body.textContent ?? ''
    for (const forbidden of [
      'Revenue',
      'NIM Received',
      'NIM received',
      'Packages Sold',
      'Sessions This Month',
      'Total customers',
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('asks for sign-in instead of showing empty provider data', async () => {
    mockApi(EMPTY_WORKSPACE)

    renderApp('/provider', { wallet: WALLET, session: null })

    expect(await screen.findByText('Sign in to manage your workspace')).toBeInTheDocument()
    expect(screen.queryByText('Add a service')).not.toBeInTheDocument()
  })

  it('surfaces an unreachable backend rather than an empty workspace', async () => {
    mockApi({
      '/api/v1/providers': offline(),
      '/api/v1/providers/00000000-0000-4000-8000-000000000002/services': offline(),
      '/api/v1/providers/00000000-0000-4000-8000-000000000002/packages': offline(),
    })

    renderApp('/provider', { wallet: WALLET, session: SESSION })

    expect(await screen.findByRole('alert')).toHaveTextContent(/Can't reach Nimpass/i)
  })
})

describe('Service form', () => {
  it('blocks submission on invalid input and never calls the API', async () => {
    const { calls } = mockApi({
      ...EMPTY_WORKSPACE,
      'POST /api/v1/providers/00000000-0000-4000-8000-000000000002/services': () => ok(aService(), 201),
    })

    const user = userEvent.setup()
    renderApp('/provider/services/new', { wallet: WALLET, session: SESSION })

    await screen.findByLabelText('Service name')
    await user.click(screen.getByRole('button', { name: 'Create service' }))

    expect(await screen.findByText('Give the service a name.')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('sends a valid service and navigates only after the backend confirms', async () => {
    const { calls } = mockApi({
      ...EMPTY_WORKSPACE,
      'POST /api/v1/providers/00000000-0000-4000-8000-000000000002/services': () => ok(aService(), 201),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/provider/services/new', { wallet: WALLET, session: SESSION })

    await user.type(await screen.findByLabelText('Service name'), 'Personal Training')
    await user.click(screen.getByRole('button', { name: 'Create service' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/provider/services'))

    const post = calls.find((call) => call.method === 'POST')
    // `ServiceInput` is `{ name, description? }` — `additionalProperties:false`.
    expect(post?.body).toEqual({ name: 'Personal Training' })
  })

  it('stays put and reports the error when the backend rejects the save', async () => {
    mockApi({
      ...EMPTY_WORKSPACE,
      'POST /api/v1/providers/00000000-0000-4000-8000-000000000002/services': () => domainError(401, 'AUTH_REQUIRED'),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/provider/services/new', { wallet: WALLET, session: SESSION })

    await user.type(await screen.findByLabelText('Service name'), 'Personal Training')
    await user.click(screen.getByRole('button', { name: 'Create service' }))

    expect(await screen.findByText("Couldn't save")).toBeInTheDocument()
    expect(screen.getByText('Your session has ended. Sign in again to continue.')).toBeInTheDocument()
    // No fake success: the form does not pretend the service was created.
    expect(router.state.location.pathname).toBe('/provider/services/new')
  })
})

describe('Package form', () => {
  const WITH_SERVICE = {
    ...EMPTY_WORKSPACE,
    '/api/v1/providers/00000000-0000-4000-8000-000000000002/services': () => ok({ items: [aService()] }),
  }

  it('sends the caller to create a service first when there is none', async () => {
    mockApi(EMPTY_WORKSPACE)

    renderApp('/provider/packages/new', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('Add a service first')).toBeInTheDocument()
  })

  it('rejects fractional sessions and non-positive prices', async () => {
    const { calls } = mockApi(WITH_SERVICE)

    const user = userEvent.setup()
    renderApp('/provider/packages/new', { wallet: WALLET, session: SESSION })

    await user.selectOptions(await screen.findByLabelText('Service'), SERVICE_ID)
    await user.type(screen.getByLabelText('Package name'), '10 Sessions')
    await user.type(screen.getByLabelText('Number of sessions'), '7.4')
    await user.type(screen.getByLabelText('Price'), '0')
    await user.click(screen.getByRole('button', { name: 'Create package' }))

    // Sessions are integers (docs/08-ARCHITECTURE.md §76).
    expect(
      await screen.findByText('Enter a whole number of sessions, at least 1.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Enter a price in NIM.')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('converts the NIM price to integer Luna before sending it', async () => {
    const { calls } = mockApi({
      ...WITH_SERVICE,
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/packages`]: () => ok({}, 201),
    })

    const user = userEvent.setup()
    renderApp('/provider/packages/new', { wallet: WALLET, session: SESSION })

    await user.selectOptions(await screen.findByLabelText('Service'), SERVICE_ID)
    await user.type(screen.getByLabelText('Package name'), '10 Personal Training Sessions')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
    await user.click(screen.getByRole('button', { name: 'Create package' }))

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))

    const post = calls.find((call) => call.method === 'POST')
    // The service is in the path (`/providers/{id}/services/{serviceId}/packages`),
    // so the body carries only the package itself.
    expect(post?.url).toContain(`/services/${SERVICE_ID}/packages`)
    // `PackageInput` names them `sessions` and `expirationAt`.
    expect(post?.body).toMatchObject({
      sessions: 10,
      priceLuna: 25_000_000,
      expirationAt: null,
    })
    // Never a float NIM amount on the wire (docs/05 §6-9).
    const body = post!.body as { priceLuna: number }
    expect(body.priceLuna % 1).toBe(0)
  })

  it('shows the derived per-session price as the provider types', async () => {
    mockApi(WITH_SERVICE)

    const user = userEvent.setup()
    renderApp('/provider/packages/new', { wallet: WALLET, session: SESSION })

    await user.type(await screen.findByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')

    expect(await screen.findByText(/25 NIM per session/)).toBeInTheDocument()
  })
})
