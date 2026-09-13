import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
 * The customer half of redemption.
 *
 * The property under test throughout: showing a code is not using a session.
 * Only the backend consumes one, and this UI may not imply otherwise
 * (docs/01-PRODUCT.md §49, docs/02-USER-FLOWS.md §48, §96).
 */
describe('customer session redemption', () => {
  const CUSTOMER = stubSession()

  it('says redemption is unavailable rather than showing a code that cannot work', async () => {
    // `backend/openapi.yaml` defines no redemption endpoints, and documents
    // GET /passes/{passID} as "no redemption in Mission 03". The screen is
    // fully built; what it must not do is imply a working flow.
    mockApi({ [`/api/v1/passes/${PASS.id}`]: () => ok(PASS) })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: CUSTOMER })

    await screen.findByRole('heading', { name: PASS.packageTitle, level: 1 })
    await user.click(screen.getByRole('button', { name: /Use a session/i }))

    expect(await screen.findByText(/We couldn't start this session/i)).toBeInTheDocument()
    expect(screen.getByText(/No session was used/i)).toBeInTheDocument()

    // And no invented code is shown.
    expect(screen.queryByText(/Show this to your provider/i)).not.toBeInTheDocument()
  })

  it('leaves the remaining count untouched when redemption fails', async () => {
    mockApi({ [`/api/v1/passes/${PASS.id}`]: () => ok(PASS) })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: CUSTOMER })

    await screen.findByRole('heading', { name: PASS.packageTitle, level: 1 })
    await user.click(screen.getByRole('button', { name: /Use a session/i }))
    await screen.findByText(/We couldn't start this session/i)

    // The balance is the backend's, and nothing on this device may move it
    // (docs/08-ARCHITECTURE.md §49).
    expect(screen.getByText('7')).toBeInTheDocument()
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
 * The provider half.
 *
 * The endpoint that resolves a scanned reference does not exist yet, so the
 * screen's job right now is to be honest about that while still exercising the
 * whole interaction: scan or type, confirm, result.
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

  it('says validation is unavailable rather than faking a successful redemption', async () => {
    mockApi(WORKSPACE)

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: PROVIDER })

    await user.type(await screen.findByLabelText('Session code'), 'NP:abc123')
    await user.click(screen.getByRole('button', { name: /Look up code/i }))

    // No backend contract for the lookup yet. The honest outcome is "not
    // available", never an invented confirmation (docs/01-PRODUCT.md §49).
    await waitFor(() =>
      expect(screen.getByText(/Session validation is unavailable/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/No session was used\./i)).toBeInTheDocument()
    expect(screen.queryByText(/Session completed/i)).not.toBeInTheDocument()
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
