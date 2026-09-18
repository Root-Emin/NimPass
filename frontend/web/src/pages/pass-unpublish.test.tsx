import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPass, aProvider, aPublicPass, mockApi, ok } from '@/test/mock-api'
import { renderApp, stubSession, stubWallet } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WALLET = stubWallet()
const SESSION = stubSession()
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'
const PASS_ID = '00000000-0000-4000-8000-000000000004'
const TITLE = '10 Guitar Lessons'

const ACCOUNT = {
  '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
  [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
}

/** Opens one card's `•••`, where every per-Pass action lives. */
async function openActions(user: ReturnType<typeof userEvent.setup>, title = TITLE) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${title}` }))
}

/**
 * Taking a Pass off the shelf, and putting it back.
 *
 * The feature is a lifecycle, not a button, so these follow it end to end:
 *
 * ```text
 * Published -> Unpublished -> Published
 * ```
 *
 * on one Pass, with one id, through the provider's own screens. What is being
 * pinned is that the two withdrawal routes stay distinct — removing from the
 * listing is reversible and keeps the Pass in My Store, deleting is neither —
 * and that the state on screen is always the *backend's*, re-read after every
 * write rather than assumed from the fact that a call returned.
 *
 * Whether any of it is permitted is not decided here. The backend authorises
 * from the session and answers 404 for a Pass this account does not own;
 * `internal/httpapi/pass_unpublish_http_test.go` covers that, along with the
 * refusal of a purchase for a withdrawn Pass.
 */
describe('removing a Pass from the listing', () => {
  it('asks first, then withdraws, and re-reads the catalogue afterwards', async () => {
    let published = true
    const { calls } = mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({
          items: [aPass({ id: PASS_ID, title: TITLE, status: published ? 'ACTIVE' : 'UNAVAILABLE' })],
        }),
      [`POST /api/v1/catalog/passes/${PASS_ID}/unpublish`]: () => {
        published = false
        return ok(aPass({ id: PASS_ID, title: TITLE, status: 'UNAVAILABLE' }))
      },
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(TITLE)).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()

    await openActions(user)
    await user.click(await screen.findByRole('button', { name: 'Remove from listing' }))

    // The pause, and exactly what it promises — the two consequences stated
    // separately, because they land on two different groups of people.
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Remove this pass from listing?')).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      /no longer be visible to new customers or available for purchase/i,
    )
    expect(dialog).toHaveTextContent(/Existing purchases will not be affected/i)
    expect(dialog).toHaveTextContent(/publish it again/i)

    // Opening the dialog is not the action.
    expect(calls.some((call) => call.url.includes('/unpublish'))).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Remove from listing' }))

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.url === `/api/v1/catalog/passes/${PASS_ID}/unpublish`,
        ),
      ).toBe(true),
    )

    // Still in My Store — this is the whole difference from delete — and now
    // labelled, because the backend says so.
    expect(await screen.findByText('Unpublished')).toBeInTheDocument()
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    // Nothing was deleted on the way.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('is not styled as a destructive action', async () => {
    mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({ items: [aPass({ id: PASS_ID, title: TITLE, status: 'ACTIVE' })] }),
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })
    await screen.findByText(TITLE)

    await openActions(user)
    await user.click(await screen.findByRole('button', { name: 'Remove from listing' }))

    // Delete's confirmation is red; this one must not be, or the two decisions
    // teach a provider that they are the same size.
    const confirm = within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Remove from listing',
    })
    expect(confirm.className).not.toMatch(/bg-danger/)
  })

  it('leaves the Pass listed when the confirmation is dismissed', async () => {
    const { calls } = mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({ items: [aPass({ id: PASS_ID, title: TITLE, status: 'ACTIVE' })] }),
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })
    await screen.findByText(TITLE)

    await openActions(user)
    await user.click(await screen.findByRole('button', { name: 'Remove from listing' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(calls.some((call) => call.url.includes('/unpublish'))).toBe(false)
    expect(screen.getByText('Published')).toBeInTheDocument()
  })

  it('keeps the Pass listed and explains, when the backend refuses', async () => {
    mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({ items: [aPass({ id: PASS_ID, title: TITLE, status: 'ACTIVE' })] }),
      [`POST /api/v1/catalog/passes/${PASS_ID}/unpublish`]: () =>
        ok({ error: { code: 'CONFLICT', message: 'Resource state conflict' } }, 409),
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })
    await screen.findByText(TITLE)

    await openActions(user)
    await user.click(await screen.findByRole('button', { name: 'Remove from listing' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove from listing' }))

    // Reported where the press happened, with the dialog still open.
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: TITLE, level: 3, hidden: true }),
    ).toBeInTheDocument()
  })
})

describe('publishing a withdrawn Pass again', () => {
  it('offers the opposite action, and puts it back on the same id', async () => {
    let published = false
    const { calls } = mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({
          items: [aPass({ id: PASS_ID, title: TITLE, status: published ? 'ACTIVE' : 'UNAVAILABLE' })],
        }),
      [`POST /api/v1/catalog/passes/${PASS_ID}/publish`]: () => {
        published = true
        return ok(aPass({ id: PASS_ID, title: TITLE, status: 'ACTIVE' }))
      },
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText(TITLE)).toBeInTheDocument()
    expect(screen.getByText('Unpublished')).toBeInTheDocument()

    await openActions(user)
    // The switch shows its other face: there is nothing to withdraw here.
    expect(screen.queryByRole('button', { name: 'Remove from listing' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Publish again' }))

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' && call.url === `/api/v1/catalog/passes/${PASS_ID}/publish`,
        ),
      ).toBe(true),
    )

    // Back on sale, as the backend now reports it. No Pass was re-created.
    expect(await screen.findByText('Published')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/passes'))).toBe(false)
  })

  it('offers publication rather than withdrawal for a Pass that was never listed', async () => {
    mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({ items: [aPass({ id: PASS_ID, title: TITLE, status: 'DRAFT' })] }),
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })
    await screen.findByText(TITLE)
    expect(screen.getByText('Not published')).toBeInTheDocument()

    await openActions(user)
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument()
    // A draft was never on the shelf, so there is nothing to remove from it —
    // and the backend would answer 409.
    expect(screen.queryByRole('button', { name: 'Remove from listing' })).not.toBeInTheDocument()
  })
})

describe('the two withdrawal routes stay separate', () => {
  it('offers both, on different routes, with different confirmations', async () => {
    const { calls } = mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({ items: [aPass({ id: PASS_ID, title: TITLE, status: 'ACTIVE' })] }),
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })
    await screen.findByText(TITLE)
    await openActions(user)

    // Both present and separately named.
    expect(await screen.findByRole('button', { name: 'Remove from listing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Pass' })).toBeInTheDocument()

    // Delete's dialog is the permanent one, and it now points at the other
    // action for someone who is in the wrong place.
    await user.click(screen.getByRole('button', { name: 'Delete Pass' }))
    const deleteDialog = await screen.findByRole('alertdialog')
    expect(within(deleteDialog).getByText('Delete this Pass?')).toBeInTheDocument()
    expect(deleteDialog).toHaveTextContent(/cannot be undone/i)
    expect(deleteDialog).toHaveTextContent(/Remove from listing/i)

    // And backing out of it sent nothing at all.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    expect(calls.some((call) => call.url.includes('/unpublish'))).toBe(false)
  })
})

describe('a withdrawn Pass in the public product', () => {
  it('cannot be bought from its old URL, and no intent is attempted', async () => {
    // The backend drops an unpublished Pass from `GET /public/passes/{id}`
    // entirely; this covers the weaker case where a client somehow holds one,
    // and asserts the frontend still refuses to start a payment for it.
    const withdrawn = aPublicPass({ pass: aPass({ status: 'UNAVAILABLE' }) })
    const { calls } = mockApi({
      [`/api/v1/public/passes/${withdrawn.pass.id}`]: () => ok(withdrawn),
    })

    renderApp(`/pass/${withdrawn.pass.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: withdrawn.pass.title, level: 1 })
    expect(screen.getAllByRole('button', { name: 'Not available' }).length).toBeGreaterThan(0)
    expect(calls.some((call) => call.url === '/api/v1/purchases')).toBe(false)
  })

  it('reports the backend refusal in the customer’s words when the tab is stale', async () => {
    // The real stale-tab case: the page was rendered while the Pass was for
    // sale, the provider withdrew it, and Buy is pressed. The rule is the
    // backend's — this asserts only that its answer is legible.
    const offer = aPublicPass()
    mockApi({
      [`/api/v1/public/passes/${offer.pass.id}`]: () => ok(offer),
      'POST /api/v1/purchases': () =>
        ok(
          {
            error: {
              code: 'PASS_UNAVAILABLE',
              message: 'This pass is no longer available for purchase',
            },
          },
          409,
        ),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${offer.pass.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: offer.pass.title, level: 1 })
    const buy = screen.getAllByRole('button', { name: /Buy with NIM/i })[0]!
    await user.click(buy)

    expect(
      await screen.findByText(/no longer available for purchase/i),
    ).toBeInTheDocument()
  })
})
