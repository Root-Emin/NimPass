import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aProvider, mockApi, ok } from '@/test/mock-api'
import { aPurchasedPass } from '@/test/fixtures'
import { renderApp, stubSession, stubWallet } from '@/test/render'
import type { PurchasedPass } from '@/types/domain'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WALLET = stubWallet()
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'

const PASS = aPurchasedPass()

/**
 * The customer half — the standing invariants.
 *
 * The ceremony itself is covered in `redemption-customer.test.tsx`. What
 * remains here is what must hold whatever the flow does: the remaining count
 * comes from the backend, and a finished pass offers no way to use a session
 * (docs/01-PRODUCT.md §49, docs/02-USER-FLOWS.md §48, §96).
 */
describe('customer session redemption', () => {
  const CUSTOMER = stubSession()

  it('keeps the remaining count exactly as the backend reports it', async () => {
    // The balance is the backend's, and nothing on this device may move it
    // (docs/08-ARCHITECTURE.md §49). The full ceremony lives in
    // `redemption-customer.test.tsx`; this is the standing invariant.
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`/api/v1/passes/${PASS.id}/redemptions`]: () => ok({ items: [] }),
      [`GET /api/v1/passes/${PASS.id}/redemption-challenges/current`]: () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'none' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: CUSTOMER })

    await screen.findByRole('heading', { name: PASS.passTitle, level: 1 })
    expect(await screen.findByText('7')).toBeInTheDocument()
    expect(screen.getByText('3 of 10 used')).toBeInTheDocument()
  })

  it('offers no way to use a session on a completed pass', async () => {
    const completed: PurchasedPass = {
      ...PASS,
      status: 'COMPLETED',
      usedSessions: 10,
      remainingSessions: 0,
    }

    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(completed),
      [`/api/v1/passes/${PASS.id}/redemptions`]: () => ok({ items: [] }),
    })

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: CUSTOMER })

    expect(
      await screen.findByText('You have used every session on this pass.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Use a session/i })).not.toBeInTheDocument()
    // Repurchase goes to the live catalog Pass, on today's terms (docs/01 §56).
    expect(screen.getByRole('link', { name: 'Buy again' })).toHaveAttribute(
      'href',
      `/pass/${PASS.passId}`,
    )
  })
})

/**
 * The provider half — the standing structural invariants.
 *
 * The real lookup-and-confirm flow lives in `redemption-provider.test.tsx`.
 * What stays here is what must remain true of the screen regardless of the
 * flow: no camera without asking, a typed path that always works, and no
 * control anywhere that could move a balance directly.
 */
describe('the provider is not part of a redemption', () => {
  const PROVIDER = stubSession()
  const WORKSPACE = {
    '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
  }

  it('never asks for the camera, because nothing scans anything', async () => {
    const getUserMedia = vi.fn()
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia },
    })

    mockApi({
      ...WORKSPACE,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
    })
    renderApp('/my-store', { wallet: WALLET, session: PROVIDER })

    await screen.findByRole('heading', { name: 'My Store', level: 1 })

    // A permission prompt nobody asked for is exactly the confirmation fatigue
    // docs/04-NIMIQ-MINI-APPS.md §55 rules out — and there is now nothing on
    // any provider screen that would need one.
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('has no redemption screen to reach at all', async () => {
    mockApi({
      ...WORKSPACE,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
    })
    renderApp('/provider/redeem', { wallet: WALLET, session: PROVIDER })

    // The old path redirects rather than 404s — it was linkable — but it
    // leads to My Store, not to a way of spending someone's session.
    await screen.findByRole('heading', { name: 'My Store', level: 1 })
    expect(screen.queryByLabelText(/Session code/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start scanning/i })).not.toBeInTheDocument()
  })

  it('gives the provider no control that could change a balance', async () => {
    mockApi({
      ...WORKSPACE,
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
    })
    const { container } = renderApp('/my-store', {
      wallet: WALLET,
      session: PROVIDER,
    })

    await screen.findByRole('heading', { name: 'My Store', level: 1 })

    // Session balances move through one authorised backend operation, signed by
    // the pass owner, and no other (docs/09-SECURITY.md §41). Nothing on a
    // provider screen takes a code, a count, or a customer.
    expect(container.querySelector('input')).toBeNull()
  })
})
