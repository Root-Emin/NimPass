import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, domainError, mockApi, ok } from '@/test/mock-api'
import { aPurchase } from '@/test/fixtures'

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

/**
 * "I already paid" — the escape from a purchase stuck at awaiting payment.
 *
 * The QR checkout is paid inside Nimiq Pay on a phone, while the intent lives
 * in a browser on another device. No client on that path can report the
 * transaction, so settlement depends on the backend sweeping the provider's
 * address — which needs an address-indexing node and an exact sender match.
 * When either is missing, the money is on chain and the purchase waits
 * forever. That is the "paid but still pending" failure.
 *
 * A QR payment settles automatically now — the backend sweeps the provider's
 * address and matches by the purchase's own on-chain reference. This is the
 * fallback for when that cannot happen: no address-indexing node, an endpoint
 * that is down, a payment made outside the flow entirely.
 *
 * Which is why the first test here is that it does *not* appear straight
 * away. A customer who has never heard of a transaction hash has to be able
 * to finish a purchase without meeting this control at all; offering it
 * beside the QR would make it read as a step.
 *
 * It settles nothing on its own either way: it nominates a transaction, which
 * then goes through the same verification every other hash does
 * (docs/09-SECURITY.md §96).
 */

const WALLET = stubWallet()
const SESSION = stubSession()
const OFFER = aPublicPass()
const PURCHASE_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PASS_ID = '40000000-0000-4000-8000-000000000001'
const TX_HASH = 'a1b2c3d4'.repeat(8)

const WAITING = aPurchase({ purchaseIntentId: PURCHASE_ID, status: 'awaiting_payment' })

/**
 * The intent has to be live before the delay can start running — the offer is
 * armed by the purchase reaching a state where reporting could help, not by
 * the page mounting.
 */
async function liveIntent() {
  // On a phone the checkout is a sheet over the page, and the recovery offer
  // is inside it — rendering it underneath would put it behind a modal.
  return screen.findByRole('dialog', { name: 'Confirm your purchase' })
}

/** Shared by every case past the first: wait out the troubleshooting delay. */
async function waitForTheOffer() {
  await liveIntent()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(95_000)
  })
  return screen.findByRole('button', { name: /Paid, but still waiting/ })
}

async function openTheForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await waitForTheOffer())
  return screen.getByLabelText('Transaction hash')
}

describe('reporting a transaction the backend never saw', () => {
  // Real time still advances, so the polling loop and userEvent behave
  // normally; only the troubleshooting delay is fast-forwarded on demand.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not offered while the automatic path still has a chance', async () => {
    // The product requirement: a customer completing an ordinary QR purchase
    // must never be shown a transaction-hash field.
    mockApi({
      [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(WAITING),
    })

    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    // The intent is live and the customer is being asked to pay.
    await liveIntent()
    expect(screen.queryByText(/Paid, but still waiting/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Transaction hash')).not.toBeInTheDocument()
  })

  it('surfaces only after the automatic path has had its chance', async () => {
    mockApi({
      [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(WAITING),
    })

    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    expect(await waitForTheOffer()).toBeInTheDocument()
  })

  it('submits a normalised hash and follows the purchase to its pass', async () => {
    let reported = false
    const { calls } = mockApi({
      [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok(
          reported
            ? aPurchase({
                purchaseIntentId: PURCHASE_ID,
                status: 'completed',
                paymentRequest: null,
                transactionHash: TX_HASH,
                purchasedPassId: PASS_ID,
              })
            : WAITING,
        ),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () => {
        reported = true
        return ok(
          aPurchase({
            purchaseIntentId: PURCHASE_ID,
            status: 'verifying',
            paymentRequest: null,
            transactionHash: TX_HASH,
          }),
          202,
        )
      },
    })

    const user = userEvent.setup()
    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    const field = await openTheForm(user)
    // Pasted from a block explorer: upper case, `0x`, stray whitespace. All
    // three are normalised rather than rejected as a confusing 400.
    await user.type(field, `  0x${TX_HASH.toUpperCase()}  `)
    await user.click(screen.getByRole('button', { name: 'Check this transaction' }))

    await waitFor(() => {
      const submission = calls.find(
        (call) => call.url === `/api/v1/purchases/${PURCHASE_ID}/transactions`,
      )
      expect(submission?.body).toEqual({ txHash: TX_HASH })
    })

    // And the purchase then settles through the ordinary path.
    expect(await screen.findByText('Payment successful', {}, { timeout: 8000 })).toBeInTheDocument()
  }, 15_000)

  it('refuses something that is not a transaction hash without asking the backend', async () => {
    const { calls } = mockApi({
      [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(WAITING),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    const field = await openTheForm(user)
    await user.type(field, 'not-a-hash')
    await user.click(screen.getByRole('button', { name: 'Check this transaction' }))

    expect(
      await screen.findByText(/That does not look like a Nimiq transaction hash/),
    ).toBeInTheDocument()
    expect(
      calls.some((call) => call.url.endsWith('/transactions')),
    ).toBe(false)
  })

  it('says a mismatched transaction is the hash’s problem, never a licence to pay again', async () => {
    mockApi({
      [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(WAITING),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        domainError(409, 'PAYMENT_CONFLICT', 'Payment state conflict'),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${OFFER.pass.id}?purchase=${PURCHASE_ID}`, {
      wallet: WALLET,
      session: SESSION,
    })

    const field = await openTheForm(user)
    await user.type(field, TX_HASH)
    await user.click(screen.getByRole('button', { name: 'Check this transaction' }))

    expect(
      await screen.findByText(/That transaction does not match this purchase/),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/do not send another payment/i).length).toBeGreaterThan(0)
    // Nothing here re-arms a purchase button.
    for (const button of screen.queryAllByRole('button', { name: /Buy with NIM/ })) {
      expect(button).toBeDisabled()
    }
  })
})
