import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPass, aProvider, aPublicPass, aService, domainError, mockApi, ok } from '@/test/mock-api'
import { aPurchasedPass, aPurchasedPassPage } from '@/test/fixtures'
import { renderApp, stubSession, stubWallet } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WALLET = stubWallet()
const SESSION = stubSession()
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'
const SERVICE_ID = '00000000-0000-4000-8000-000000000003'
const MEDIA_ID = '11111111-2222-4333-8444-555555555555'
const COVER = `/api/v1/media/${MEDIA_ID}`

const ACCOUNT = {
  '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
  [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
}

/**
 * My Store is the second half of one account: My Passes is what this wallet
 * bought, My Store is what it made. They are different objects — a purchased
 * pass has its own session balance, a catalog Pass has a price and a published
 * state — and the product keeps them apart rather than merging them into one
 * list of "passes".
 */
describe('My Store', () => {
  it('lists the Passes this wallet made, with their artwork and standing', async () => {
    mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({
          items: [
            aPass({ title: '10 Guitar Lessons', status: 'ACTIVE', coverUrl: COVER }),
            aPass({
              id: '00000000-0000-4000-8000-000000000005',
              title: '5 Guitar Lessons',
              status: 'DRAFT',
              priceLuna: 14_000_000,
            }),
          ],
        }),
    })

    renderApp('/my-store', { wallet: WALLET, session: SESSION })

    expect(await screen.findByRole('heading', { name: 'My Store', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('10 Guitar Lessons')).toBeInTheDocument()
    expect(screen.getByText('5 Guitar Lessons')).toBeInTheDocument()

    // The uploaded cover is rendered as the pass's artwork, from the path the
    // contract returned — nothing else is accepted as an image source.
    const image = document.querySelector('img[src$="' + COVER + '"]')
    expect(image).not.toBeNull()

    // Published state is stated in words, and never as the word "Draft".
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText('Not published')).toBeInTheDocument()
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
  })

  it('invents no sales figures for passes the contract cannot report', async () => {
    mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [aPass()] }),
    })

    renderApp('/my-store', { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: 'My Store', level: 1 })

    // `backend/openapi.yaml` has no provider-side view of purchased passes, so
    // there is nothing here that would need one (docs/08-ARCHITECTURE.md §11).
    const text = document.body.textContent ?? ''
    for (const invented of ['sold', 'Revenue', 'Earned', 'customers', 'views']) {
      expect(text).not.toContain(invented)
    }
  })

  it('keeps bought and made apart', async () => {
    const bought = aPurchasedPass({ passTitle: 'A pass I bought' })

    mockApi({
      ...ACCOUNT,
      '/api/v1/passes': () => ok(aPurchasedPassPage([bought])),
      '/api/v1/purchases': () => ok({ items: [] }),
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({ items: [aPass({ title: 'A pass I made' })] }),
      [`/api/v1/public/passes/${bought.passId}`]: () => ok(aPublicPass()),
    })

    const { router } = renderApp('/my-store', { wallet: WALLET, session: SESSION })
    expect(await screen.findByText('A pass I made')).toBeInTheDocument()
    expect(screen.queryByText('A pass I bought')).not.toBeInTheDocument()

    await router.navigate('/passes')
    expect(await screen.findByText('A pass I bought')).toBeInTheDocument()
    expect(screen.queryByText('A pass I made')).not.toBeInTheDocument()
  })

  it('opens a Pass on the screen that manages it', async () => {
    mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [aPass()] }),
    })

    renderApp('/my-store', { wallet: WALLET, session: SESSION })

    const card = await screen.findByRole('link', { name: /10 Personal Training Sessions/ })
    expect(card).toHaveAttribute(
      'href',
      '/provider/passes/00000000-0000-4000-8000-000000000004/edit',
    )
  })

  it('sends the old provider paths here rather than nowhere', async () => {
    mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
    })

    const { router } = renderApp('/provider/passes', { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: 'My Store', level: 1 })
    expect(router.state.location.pathname).toBe('/my-store')
  })
})

/**
 * The step between filling the form in and a Pass existing.
 *
 * Creating a Pass is not reversible from the UI, so the press that used to
 * write it now opens a preview of what is about to be written. Everything the
 * dialog shows is the form's own state; confirming is the only thing that
 * writes, and going back leaves every field exactly as it was.
 */
describe('Confirming a new Pass', () => {
  const ROUTES = {
    ...ACCOUNT,
    [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
    [`POST /api/v1/providers/${PROVIDER_ID}/services`]: () =>
      ok(aService({ id: SERVICE_ID }), 201),
    [`PATCH /api/v1/services/${SERVICE_ID}`]: () =>
      ok(aService({ id: SERVICE_ID, status: 'ACTIVE' })),
  }

  async function fillForm(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText('Pass name'), '10 Guitar Lessons')
    await user.type(screen.getByLabelText('Number of sessions'), '10')
    await user.type(screen.getByLabelText('Price'), '250')
  }

  it('previews the Pass instead of creating it', async () => {
    const { calls } = mockApi(ROUTES)

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Ready to create this Pass?')).toBeInTheDocument()
    // What is about to be created, in the terms it will be sold in. The
    // artwork carries the same figures, so these are counted rather than
    // matched once.
    expect(within(dialog).getAllByText('10 sessions').length).toBeGreaterThan(0)
    expect(within(dialog).getAllByText('250 NIM').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('25 NIM')).toBeInTheDocument()

    // And not one byte written yet.
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('returns to the form with everything still typed in', async () => {
    const { calls } = mockApi(ROUTES)

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: /Add description/ }))
    await user.type(
      screen.getByRole('textbox', { name: /Description/ }),
      'Two sessions a week, in my studio.',
    )

    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Continue editing' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // The form was never unmounted, so nothing had to be restored.
    expect(screen.getByLabelText('Pass name')).toHaveValue('10 Guitar Lessons')
    expect(screen.getByLabelText('Number of sessions')).toHaveValue(10)
    expect(screen.getByLabelText('Price')).toHaveValue(250)
    expect(screen.getByRole('textbox', { name: /Description/ })).toHaveValue(
      'Two sessions a week, in my studio.',
    )
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('creates the Pass, puts it on sale and opens its public page', async () => {
    // One press. The Pass is created, published and the provider lands on the
    // link customers use — there is no draft waiting behind a second button.
    const created = 'ffffffff-0000-4000-8000-000000000001'
    const { calls } = mockApi({
      ...ROUTES,
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/passes`]: () =>
        ok(aPass({ id: created, status: 'DRAFT' }), 201),
      [`POST /api/v1/catalog/passes/${created}/publish`]: () =>
        ok(aPass({ id: created, status: 'ACTIVE' })),
      [`/api/v1/public/passes/${created}`]: () =>
        ok(aPublicPass({ pass: aPass({ id: created, status: 'ACTIVE' }) })),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Create Pass' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pass/${created}`))
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' && call.url === `/api/v1/catalog/passes/${created}/publish`,
      ),
    ).toBe(true)
  })

  it('keeps the created Pass and explains it when publishing is refused', async () => {
    // The write succeeded and the listing did not. The create form is the one
    // screen this must not stay on — pressing Create again would write a
    // second Pass — so it opens the Pass that exists, with the reason.
    const created = 'ffffffff-0000-4000-8000-000000000001'
    mockApi({
      ...ROUTES,
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/passes`]: () =>
        ok(aPass({ id: created, status: 'DRAFT' }), 201),
      [`POST /api/v1/catalog/passes/${created}/publish`]: () =>
        domainError(409, 'PASS_NOT_PUBLISHABLE', 'This pass cannot be published yet.'),
      [`/api/v1/catalog/passes/${created}`]: () => ok(aPass({ id: created, status: 'DRAFT' })),
    })

    const user = userEvent.setup()
    const { router } = renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Create Pass' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/provider/passes/${created}/edit`),
    )
    expect(await screen.findByText('Created, but not on sale yet')).toBeInTheDocument()
    // And the action that finishes the job is right there.
    expect(await screen.findByRole('button', { name: /Publish Pass/i })).toBeInTheDocument()
  })

  it('writes one Pass however often the button is pressed', async () => {
    const created = 'ffffffff-0000-4000-8000-000000000001'
    let writes = 0
    const { calls } = mockApi({
      ...ROUTES,
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/passes`]: async () => {
        writes += 1
        // Slow enough that a second press lands while the first is in flight,
        // which is exactly the double-submit this guards against.
        await new Promise((resolve) => setTimeout(resolve, 30))
        return ok(aPass({ id: created, status: 'DRAFT' }), 201)
      },
      [`/api/v1/catalog/passes/${created}`]: () => ok(aPass({ id: created, status: 'DRAFT' })),
    })

    const user = userEvent.setup()
    renderApp('/provider/passes/new', { wallet: WALLET, session: SESSION })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Create Pass' }))
    const dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'Create Pass' })

    await Promise.all([user.click(confirm), user.click(confirm), user.click(confirm)])
    await waitFor(() => expect(writes).toBe(1))

    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/passes'))).toHaveLength(1)
  })
})
