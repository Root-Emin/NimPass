import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { aPublicPass, mockApi, ok } from '@/test/mock-api'
import { aPurchase } from '@/test/fixtures'

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

/**
 * The success dialog, and the four things that make it trustworthy.
 *
 * It must appear when the *backend* says the purchase completed and a pass
 * exists — not when a wallet returned a hash, not while the chain is being
 * read, and not again tomorrow for a purchase that completed today.
 *
 * `COMPLETE` is the only state that satisfies the first of those: the backend
 * reaches it after verifying the transaction on chain, waiting for macro-block
 * finality and issuing the pass, all in the transaction whose result is being
 * read here (docs/05-NIMIQ-PAY-INTEGRATION.md §44, §54).
 */

const WALLET = stubWallet()
const SESSION = stubSession()
const OFFER = aPublicPass()
const PURCHASE_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PASS_ID = '40000000-0000-4000-8000-000000000001'

function purchaseAt(status: 'verifying' | 'awaiting_finality' | 'completed') {
  return aPurchase({
    purchaseIntentId: PURCHASE_ID,
    status,
    paymentRequest: null,
    transactionHash: 'a1b2c3d4'.repeat(8),
    purchasedPassId: status === 'completed' ? PASS_ID : null,
  })
}

function mountAt(status: 'verifying' | 'awaiting_finality' | 'completed') {
  return mockApi({
    [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
    [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(purchaseAt(status)),
    [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(purchaseAt(status)),
  })
}

describe('the payment success dialog', () => {
  it('stays shut while the payment is only being verified', async () => {
    mountAt('verifying')

    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    // The checkout sheet is up and following the payment — that is the point of
    // it — but it is reporting progress, not success.
    const sheet = await screen.findByRole('dialog', { name: 'Confirming your payment' })
    expect(within(sheet).getByText('Confirming your payment…')).toBeInTheDocument()
    expect(screen.queryByText('Payment successful')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View pass' })).not.toBeInTheDocument()
  })

  it('stays shut while the chain has yet to finalise it', async () => {
    // Real progress, and emphatically not a completed purchase: no pass
    // exists yet, so there would be nothing for "View pass" to open.
    mountAt('awaiting_finality')

    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    expect(await screen.findByText('Finalising your payment…')).toBeInTheDocument()
    expect(screen.queryByText('Payment successful')).not.toBeInTheDocument()
  })

  it('opens once the backend has issued the pass, and links to that pass', async () => {
    mountAt('completed')

    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    const dialog = await screen.findByRole('dialog')
    expect(await screen.findByText('Payment successful')).toBeInTheDocument()
    expect(screen.getByText('Your pass has been added to My Passes.')).toBeInTheDocument()
    // The link points at the pass the backend actually created, not at an id
    // the screen assembled.
    expect(screen.getByRole('link', { name: 'View pass' })).toHaveAttribute(
      'href',
      `/passes/${PASS_ID}`,
    )
    expect(dialog).toBeInTheDocument()
  })

  it('fits a phone: nothing unbreakable, nothing squeezed, and a short receipt line', async () => {
    /*
     * jsdom does not lay out, so this cannot measure a width. What it *can*
     * hold is the four rules that made the screen overflow at 375px, each of
     * which is a property of the markup rather than of the rendering:
     *
     *   - the receipt line is short, and only the hash may break,
     *   - the column holding it may shrink below its content,
     *   - the actions stack full-width below `sm`,
     *   - the panel is capped rather than sized by its content.
     *
     * The measured check is the headless-Chrome pass at 375/390/430/768/1440,
     * which is what caught these in the first place.
     */
    mountAt('completed')

    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    const dialog = await screen.findByRole('dialog')
    const hash = 'a1b2c3d4'.repeat(8)

    // The receipt names a real, recognisable substring of the real hash — head
    // and tail — and keeps the whole value available. It used to print all 64
    // characters, because `shortenId` splits on a hyphen a hash does not have.
    const receipt = within(dialog).getByTitle(hash)
    expect(receipt.textContent).not.toContain(hash)
    expect(receipt.textContent).toContain(hash.slice(0, 8))
    expect(receipt.textContent).toContain(hash.slice(-8))
    // `break-all` is scoped to the hash alone, so "verified on Nimiq" can never
    // be split into "Ni miq".
    expect(receipt.className).not.toMatch(/break-all/)
    expect(receipt.querySelector('.break-all')?.textContent).toMatch(/^a1b2c3d4…/)

    // The flex column holding it must be allowed to shrink; without this the
    // panel scrolls sideways at every phone width.
    expect(receipt.parentElement?.className).toMatch(/min-w-0/)

    // Both actions are full-width below `sm` and auto from `sm`.
    for (const name of ['Done', 'View pass']) {
      const control = within(dialog).getByRole(name === 'Done' ? 'button' : 'link', { name })
      const box = name === 'Done' ? control : control.closest('a')!
      expect(box.className).toMatch(/w-full/)
      expect(box.className).toMatch(/sm:w-auto/)
    }

    // And the panel is capped, never sized by whatever is inside it.
    expect(dialog.className).toMatch(/max-w-md/)
  })

  it('closes on Done and leaves the quiet confirmation behind it', async () => {
    mountAt('completed')

    const user = userEvent.setup()
    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    await screen.findByText('Payment successful')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Dismissing the announcement must not dismiss the outcome.
    expect(screen.getByText('Pass added to My Passes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open your pass' })).toHaveAttribute(
      'href',
      `/passes/${PASS_ID}`,
    )
  })

  it('does not congratulate the same purchase twice', async () => {
    // A completed purchase stays completed, so the state that opens the
    // dialog is still true on the next visit. Without a memory the customer
    // would be congratulated every time they opened the page.
    mountAt('completed')

    const first = renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })
    await screen.findByText('Payment successful')
    first.unmount()

    mountAt('completed')
    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    // The purchase is still visibly complete...
    expect(await screen.findByText('Pass added to My Passes')).toBeInTheDocument()
    // ...and the dialog does not reopen.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Payment successful')).not.toBeInTheDocument()
  })
})
