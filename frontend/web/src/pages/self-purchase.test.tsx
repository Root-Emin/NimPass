import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { aPublicPass, aPublicProvider, domainError, mockApi, ok } from '@/test/mock-api'

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

/**
 * A provider cannot buy their own pass.
 *
 * Two independent facts, and the test says so twice on purpose:
 *
 *  1. the screen does not offer it, and
 *  2. the backend refuses it even when the screen is bypassed.
 *
 * Only the second is a rule. Nimpass has one kind of account — the same
 * wallet buys and sells — so "is this mine?" is a real question on every pass
 * page, and getting the presentation right matters; but the presentation is
 * never what stops the purchase (docs/09-SECURITY.md §11, §37).
 */

const OWNER_WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081'
const WALLET = stubWallet()

/** A listing whose provider is the account that is signed in. */
const OWN_OFFER = aPublicPass({ provider: aPublicProvider({ wallet: OWNER_WALLET }) })
/** The same listing, sold by somebody else. */
const OTHER_OFFER = aPublicPass()

describe('a provider looking at their own pass', () => {
  it('is offered its edit link instead of a Buy button', async () => {
    mockApi({ [`/api/v1/public/passes/${OWN_OFFER.pass.id}`]: () => ok(OWN_OFFER) })

    renderApp(`/pass/${OWN_OFFER.pass.id}`, { wallet: WALLET, session: stubSession() })

    // The panel and the sticky mobile bar both render the control, and
    // neither may offer a purchase: asserting on all of them is the point.
    const buttons = await screen.findAllByRole('button', { name: 'Your pass' })
    for (const button of buttons) expect(button).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Buy with NIM/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Edit this pass' })[0]).toHaveAttribute(
      'href',
      `/provider/passes/${OWN_OFFER.pass.id}/edit`,
    )
    expect(
      screen.getAllByText(/You created this pass, so you cannot buy it/).length,
    ).toBeGreaterThan(0)
  })

  it('never asks the backend for an intent it cannot have', async () => {
    const { calls } = mockApi({
      [`/api/v1/public/passes/${OWN_OFFER.pass.id}`]: () => ok(OWN_OFFER),
    })

    renderApp(`/pass/${OWN_OFFER.pass.id}`, { wallet: WALLET, session: stubSession() })
    await screen.findAllByRole('button', { name: 'Your pass' })

    expect(calls.some((call) => call.url === '/api/v1/purchases')).toBe(false)
  })

  it('still shows an ordinary Buy button to everybody else', async () => {
    // The refusal has to be specific to the relationship, not a Buy button
    // that quietly stopped working for everyone.
    mockApi({ [`/api/v1/public/passes/${OTHER_OFFER.pass.id}`]: () => ok(OTHER_OFFER) })

    renderApp(`/pass/${OTHER_OFFER.pass.id}`, { wallet: WALLET, session: stubSession() })

    for (const button of await screen.findAllByRole('button', { name: /Buy with NIM/ })) {
      expect(button).toBeEnabled()
    }
    expect(screen.queryByRole('button', { name: 'Your pass' })).not.toBeInTheDocument()
  })

  it('reports the backend refusal as ownership, not as a payment failure', async () => {
    /*
     * The screen is not the rule, so this is what happens when the rule fires
     * anyway: a stale page, a pass whose provider changed hands, or a request
     * made by hand. The purchase flow has to render the backend's answer, and
     * the answer is "this is yours" — telling this customer their payment
     * failed would be false and would invite them to try again.
     *
     * Rendered against the pass that does *not* look like the viewer's, so the
     * presentation check above cannot be what produces the result.
     */
    mockApi({
      [`/api/v1/public/passes/${OTHER_OFFER.pass.id}`]: () => ok(OTHER_OFFER),
      'POST /api/v1/purchases': () =>
        domainError(403, 'SELF_PURCHASE_NOT_ALLOWED', 'You cannot buy a pass you created'),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${OTHER_OFFER.pass.id}`, { wallet: WALLET, session: stubSession() })

    await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/ }))[0]!)

    expect(await screen.findByText('This is your pass')).toBeInTheDocument()
    expect(screen.getAllByText('You have not been charged.').length).toBeGreaterThan(0)
    // Never dressed as a failed payment, and never retryable.
    expect(screen.queryByText(/Payment couldn't be completed/)).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument(),
    )
  })
})
