import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { mockApi, ok } from '@/test/mock-api'
import { renderApp, stubSession, stubWallet } from '@/test/render'
import { NO_CAPABILITIES } from '@/types/wallet'

describe('header identity control', () => {
  it('says Login when nobody is signed in, in an ordinary browser too', async () => {
    mockApi({ '/api/v1/public/passes': () => ok({ items: [] }) })
    renderApp('/discover')

    // "Wallet" described the mechanism; a visitor has to be able to see that
    // Nimpass has an account at all, whichever runtime they are in.
    expect(await screen.findByRole('button', { name: 'Login' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument()
  })

  it('offers the real wallet login in an ordinary browser too', async () => {
    mockApi({ '/api/v1/public/passes': () => ok({ items: [] }) })
    const user = userEvent.setup()
    // No wallet is stubbed, so this is the real desktop-browser runtime: the
    // Nimiq Hub. Login must start an actual wallet flow rather than explain
    // that a phone is required.
    renderApp('/discover')

    await user.click(await screen.findByRole('button', { name: 'Login' }))
    expect(
      await screen.findByRole('heading', { name: 'Log in with your wallet' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /Login happens in Nimiq Pay/i }),
    ).not.toBeInTheDocument()
  })

  it('says so when neither transport can be reached, instead of a dead action', async () => {
    mockApi({ '/api/v1/public/passes': () => ok({ items: [] }) })
    const user = userEvent.setup()
    renderApp('/discover', {
      wallet: stubWallet({ status: 'unavailable', capabilities: NO_CAPABILITIES, account: null }),
      session: null,
    })

    await user.click(await screen.findByRole('button', { name: 'Login' }))
    expect(
      await screen.findByRole('heading', { name: "Wallet login isn't available right now" }),
    ).toBeInTheDocument()
  })

  it('offers the real wallet login inside Nimiq Pay', async () => {
    mockApi({ '/api/v1/public/passes': () => ok({ items: [] }) })
    const user = userEvent.setup()
    renderApp('/discover', { wallet: stubWallet(), session: null })

    await user.click(await screen.findByRole('button', { name: 'Login' }))
    expect(
      await screen.findByRole('heading', { name: 'Log in with your wallet' }),
    ).toBeInTheDocument()
  })

  it('says Profile, not Wallet or the address, once the wallet session exists', async () => {
    mockApi({ '/api/v1/public/passes': () => ok({ items: [] }) })
    renderApp('/discover', { wallet: stubWallet(), session: stubSession() })

    expect(await screen.findByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument()
    expect(screen.queryByText(/NQ07/)).not.toBeInTheDocument()
  })

  it('opens the profile page rather than a sheet', async () => {
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [] }),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/discover', { wallet: stubWallet(), session: stubSession() })

    await user.click(await screen.findByRole('link', { name: 'Profile' }))

    // The route is code-split, so the navigation settles once its module loads.
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    expect(await screen.findByRole('heading', { name: 'Profile', level: 1 })).toBeInTheDocument()
  })

  it('marks a wallet that has drifted from the signed-in identity', async () => {
    mockApi({ '/api/v1/public/passes': () => ok({ items: [] }) })
    renderApp('/discover', {
      // Nimiq Pay lets someone switch accounts while a Nimpass session is open.
      // The session stays bound to the wallet it was issued for, so the header
      // has to admit the drift rather than look normal until a payment fails.
      wallet: stubWallet({ account: 'NQ55 0000 0000 0000 0000 0000 0000 0000 0099' }),
      session: stubSession(),
    })

    expect(await screen.findByText('Wallet changed')).toBeInTheDocument()
  })
})
