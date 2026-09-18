import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { aPublicPass, domainError, mockApi, ok } from '@/test/mock-api'
import { aPurchasedPass, aPurchasedPassPage } from '@/test/fixtures'

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

/**
 * One live pass per Pass.
 *
 * A customer who is still holding sessions does not buy the same Pass a second
 * time — they use what they have, and `Buy Again` sells them the current terms
 * once it is finished (docs/01-PRODUCT.md §56, docs/02-USER-FLOWS.md §70).
 *
 * Two independent facts again, and for the same reason as the self-purchase
 * tests: the screen does not offer it, and the backend refuses it when the
 * screen is bypassed. Only the second is the rule.
 */

const WALLET = stubWallet()
const OFFER = aPublicPass()
const HELD = aPurchasedPass({ passId: OFFER.pass.id, remainingSessions: 7, usedSessions: 3 })

describe('a customer who already holds this pass', () => {
  it('is pointed at the pass they have instead of a Buy button', async () => {
    mockApi({
      [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
      '/api/v1/passes': () => ok(aPurchasedPassPage([HELD])),
    })

    renderApp(`/pass/${OFFER.pass.id}`, { wallet: WALLET, session: stubSession() })

    expect((await screen.findAllByRole('link', { name: 'Open your pass' }))[0]).toHaveAttribute(
      'href',
      `/passes/${HELD.id}`,
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Buy with NIM/ })).not.toBeInTheDocument(),
    )
    expect(screen.getAllByText(/You already have this pass, with 7 sessions left/).length).toBeGreaterThan(0)
  })

  it('still offers the Buy button once that pass has no sessions left', async () => {
    // Completed is exactly the state `Buy Again` starts from, so the control
    // has to come back — a rule that never lifts would end the commercial loop.
    mockApi({
      [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
      '/api/v1/passes': () =>
        ok(aPurchasedPassPage([{ ...HELD, usedSessions: 10, remainingSessions: 0, status: 'COMPLETED' }])),
    })

    renderApp(`/pass/${OFFER.pass.id}`, { wallet: WALLET, session: stubSession() })

    for (const button of await screen.findAllByRole('button', { name: /Buy with NIM/ })) {
      expect(button).toBeEnabled()
    }
    expect(screen.queryByRole('link', { name: 'Open your pass' })).not.toBeInTheDocument()
  })

  it('reports the backend refusal as ownership, not as a payment failure', async () => {
    /*
     * The screen is not the rule. This is the stale tab, the second device, or
     * the customer whose list of active passes is longer than one page: the
     * button is there, the backend refuses, and the answer has to be rendered
     * as what it is. Telling them the payment failed would invite exactly the
     * second payment this rule exists to prevent.
     */
    mockApi({
      [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      'POST /api/v1/purchases': () =>
        domainError(409, 'PASS_ALREADY_OWNED', 'You already own this pass'),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${OFFER.pass.id}`, { wallet: WALLET, session: stubSession() })

    await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/ }))[0]!)

    expect(await screen.findByText('You already have this pass')).toBeInTheDocument()
    expect(screen.getAllByText('You have not been charged.').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Payment couldn't be completed/)).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument(),
    )
  })
})

/**
 * The window where a payment may already be on its way.
 *
 * An intent stays payable for five minutes after its TTL so a QR payment made
 * in time still settles. A second intent inside that window is how one customer
 * pays twice, so the backend refuses it — and this screen is the one place a
 * "Try again" button would be actively dangerous.
 */
describe('a customer whose last attempt is still settling', () => {
  it('is told to wait rather than offered another payment', async () => {
    mockApi({
      [`/api/v1/public/passes/${OFFER.pass.id}`]: () => ok(OFFER),
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      'POST /api/v1/purchases': () =>
        domainError(409, 'PURCHASE_IN_SETTLEMENT', 'Your last payment for this pass is still being checked'),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${OFFER.pass.id}`, { wallet: WALLET, session: stubSession() })

    await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/ }))[0]!)

    expect(await screen.findByText('Still checking your last payment')).toBeInTheDocument()
    // The one refusal that must not claim nothing was charged.
    expect(screen.queryByText('You have not been charged.')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Do not pay again/).length).toBeGreaterThan(0)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument(),
    )
  })
})
