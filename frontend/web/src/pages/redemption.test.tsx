import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aProvider, mockApi, ok } from '@/test/mock-api'
import { aPass } from '@/test/fixtures'
import { renderApp, stubSession, stubWallet } from '@/test/render'
import type { Pass } from '@/types/domain'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WALLET = stubWallet()
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'

const PASS = aPass()

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

    await screen.findByRole('heading', { name: PASS.packageTitle, level: 1 })
    expect(await screen.findByText('7')).toBeInTheDocument()
    expect(screen.getByText(/of 10 sessions left/)).toBeInTheDocument()
  })

  it('offers no way to use a session on a completed pass', async () => {
    const completed: Pass = {
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
    // Repurchase goes to the live package, on today's terms (docs/01 §56).
    expect(screen.getByRole('link', { name: 'Buy again' })).toHaveAttribute(
      'href',
      `/packages/${PASS.packageId}`,
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
describe('provider session redemption', () => {
  const PROVIDER = stubSession()
  const WORKSPACE = {
    '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
  }

  it('never asks for the camera just because the page loaded', async () => {
    const getUserMedia = vi.fn()
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia },
    })

    mockApi(WORKSPACE)
    renderApp('/provider/redeem', { wallet: WALLET, session: PROVIDER })

    // Wait for the workspace to finish loading, so "nothing happened" is a
    // real observation rather than the page not having rendered yet.
    await screen.findByRole('button', { name: /Start scanning/i })

    // A permission prompt nobody asked for is exactly the confirmation fatigue
    // docs/04-NIMIQ-MINI-APPS.md §55 rules out.
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('always offers the typed-code path, so redemption never needs a camera', async () => {
    mockApi(WORKSPACE)
    renderApp('/provider/redeem', { wallet: WALLET, session: PROVIDER })

    // Nimpass is web-first; a provider on a desktop must be able to redeem
    // (docs/01-PRODUCT.md §25, §40).
    expect(await screen.findByLabelText('Session code')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Look up code/i })).toBeInTheDocument()
  })

  it('gives the provider no control that could change a balance directly', async () => {
    mockApi(WORKSPACE)
    const { container } = renderApp('/provider/redeem', {
      wallet: WALLET,
      session: PROVIDER,
    })

    await screen.findByLabelText('Session code')

    // Session balances move through one authorised backend operation and no
    // other (docs/09-SECURITY.md §41). The only input on this screen is the
    // code being looked up.
    const inputs = Array.from(container.querySelectorAll('input'))
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toHaveAccessibleName('Session code')
    expect(container.querySelector('input[type="number"]')).toBeNull()
  })

  it('keeps redemption one click from the workspace', async () => {
    mockApi(WORKSPACE)
    renderApp('/provider', { wallet: WALLET, session: PROVIDER })

    // Redemption is the provider's most frequent in-person action and must not
    // be buried (docs/02-USER-FLOWS.md §49).
    const nav = await screen.findByRole('navigation', { name: 'Provider workspace' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Redeem' })).toHaveAttribute(
      'href',
      '/provider/redeem',
    )
  })
})
