import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPass, aProvider, mockApi, ok } from '@/test/mock-api'
import { renderApp, stubSession, stubWallet } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WALLET = stubWallet()
const SESSION = stubSession()
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'
const PASS_ID = '00000000-0000-4000-8000-000000000004'

const ACCOUNT = {
  '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
  [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
}

/** Opens one card's `•••`, where every per-Pass action now lives. */
async function openActions(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${title}` }))
}

/**
 * Deleting a Pass, from the provider's side of the product.
 *
 * Three things are being pinned here, and only the first is about the button:
 *
 *  - it is never a one-tap action; it sits inside the card's `•••` menu and a
 *    confirmation stands in front of it after that,
 *  - the confirmation says what actually happens to the two groups of people
 *    affected — nobody can buy it any more, everybody who already did keeps
 *    what they have,
 *  - the request is `DELETE /catalog/passes/{id}`, and the list afterwards is
 *    whatever the *backend* says it is. The row is not spliced out of a cache
 *    on the assumption the call worked.
 *
 * Whether the delete is permitted at all is not decided here. The backend
 * authorises it from the session and answers 404 for a Pass this account does
 * not own, which `internal/httpapi/pass_delete_http_test.go` covers.
 */
describe('deleting a Pass', () => {
  it('asks first, then deletes, and re-reads the catalogue afterwards', async () => {
    let deleted = false
    const { calls } = mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({ items: deleted ? [] : [aPass({ id: PASS_ID, title: '10 Guitar Lessons' })] }),
      [`DELETE /api/v1/catalog/passes/${PASS_ID}`]: () => {
        deleted = true
        return ok(aPass({ id: PASS_ID, title: '10 Guitar Lessons', status: 'ARCHIVED' }))
      },
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('10 Guitar Lessons')).toBeInTheDocument()

    await openActions(user, '10 Guitar Lessons')
    await user.click(await screen.findByRole('button', { name: 'Delete Pass' }))

    // The pause, and what it promises.
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete this Pass?')).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/no longer be available for new purchases/i)
    expect(dialog).toHaveTextContent(/already bought are unaffected/i)

    // Nothing has been sent yet: opening the dialog is not the action.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Delete Pass' }))

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === 'DELETE' && call.url === `/api/v1/catalog/passes/${PASS_ID}`,
        ),
      ).toBe(true),
    )

    // Gone, because the backend now says the catalogue is empty.
    await waitFor(() => expect(screen.queryByText('10 Guitar Lessons')).not.toBeInTheDocument())
    expect(await screen.findByText('No passes yet')).toBeInTheDocument()
  })

  it('leaves the Pass alone when the confirmation is dismissed', async () => {
    const { calls } = mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({ items: [aPass({ id: PASS_ID, title: '10 Guitar Lessons' })] }),
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })

    await screen.findByText('10 Guitar Lessons')
    await openActions(user, '10 Guitar Lessons')
    await user.click(await screen.findByRole('button', { name: 'Delete Pass' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    // Backing out of the menu too, so the store is on screen rather than behind
    // a modal that marks it aria-hidden.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    // The card, specifically: the menu was titled with the same name.
    expect(screen.getByRole('heading', { name: '10 Guitar Lessons', level: 3 })).toBeInTheDocument()
  })

  it('keeps the Pass and explains, when the backend refuses', async () => {
    mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({ items: [aPass({ id: PASS_ID, title: '10 Guitar Lessons' })] }),
      [`DELETE /api/v1/catalog/passes/${PASS_ID}`]: () =>
        ok({ error: { code: 'CONFLICT', message: 'Resource state conflict' } }, 409),
    })

    const user = userEvent.setup()
    renderApp('/my-store', { wallet: WALLET, session: SESSION })

    await screen.findByText('10 Guitar Lessons')
    await openActions(user, '10 Guitar Lessons')
    await user.click(await screen.findByRole('button', { name: 'Delete Pass' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete Pass' }))

    // The refusal is reported where the press happened, and the dialog stays
    // open — a disappearing toast is the wrong home for something the provider
    // still has to decide about.
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    // Still in the store behind the dialog. `hidden` because an open modal
    // marks the rest of the page aria-hidden — the card is there, not reachable
    // while the decision is pending, which is the point.
    expect(
      screen.getByRole('heading', { name: '10 Guitar Lessons', level: 3, hidden: true }),
    ).toBeInTheDocument()
  })

  it('offers no delete for a Pass that is already archived', async () => {
    mockApi({
      ...ACCOUNT,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () =>
        ok({
          items: [aPass({ id: PASS_ID, title: '10 Guitar Lessons', status: 'ARCHIVED' })],
        }),
    })

    renderApp('/my-store', { wallet: WALLET, session: SESSION })

    await screen.findByText('10 Guitar Lessons')
    // There is nothing left to delete and the backend answers 409, so the
    // control is absent rather than present and doomed — and with no action
    // left on an archived Pass, the menu that would hold it is gone too.
    expect(
      screen.queryByRole('button', { name: /Actions for 10 Guitar Lessons/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument()
  })
})
