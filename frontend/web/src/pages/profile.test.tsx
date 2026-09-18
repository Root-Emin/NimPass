import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { aCompensationPurchase, aPurchasedPass, aPurchasedPassPage, aPurchase } from '@/test/fixtures'
import { aPass, aProvider, domainError, mockApi, noContent, ok } from '@/test/mock-api'
import { renderApp, stubSession, stubWallet } from '@/test/render'

const PASS_ID = '40000000-0000-4000-8000-000000000001'

describe('profile page', () => {
  it('explains what an account is when nobody is logged in', async () => {
    mockApi({})
    renderApp('/profile')

    expect(await screen.findByRole('heading', { name: "You're not logged in" })).toBeInTheDocument()
    // The wallet *is* the registration: there is no second sign-up step, and
    // the page has to say so (docs/01-PRODUCT.md §53).
    expect(screen.getByText(/creates your Nimpass account/i)).toBeInTheDocument()
  })

  it('shows the verified identity and its full address', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    expect(await screen.findByText(/NQ07…81/)).toBeInTheDocument()
    // Shortened everywhere else; shown in full here, because this is the one
    // screen where the person is asking who they are logged in as.
    expect(
      screen.getByText('NQ07 0000 0000 0000 0000 0000 0000 0000 0081'),
    ).toBeInTheDocument()
    // Split across elements by interpolation, so match on the whole line.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          /Logged in with your wallet · Nimiq Testnet/i.test(element.textContent ?? ''),
      ),
    ).toBeInTheDocument()
  })

  it('counts passes from the backend rather than inventing totals', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([aPurchasedPass({ id: PASS_ID })])),
      '/api/v1/purchases': () =>
        ok({ items: [aPurchase({ status: 'completed', purchasedPassId: PASS_ID })] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    const sessionsLeft = await screen.findByText('Sessions left')
    // 7 remaining on one active pass — the backend's counter, summed, not
    // recomputed from used/original.
    expect(sessionsLeft.parentElement).toHaveTextContent('7')
  })

  it('surfaces a payment that produced no pass', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [aCompensationPurchase()] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    // A compensation case must never be silently absent from the account
    // screen — that is what a lost payment looks like to the customer.
    expect(await screen.findByText("Payments we're still resolving")).toBeInTheDocument()
  })

  it('reads provider standing from the provider record, not from the session', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [aProvider()] }),
      '/api/v1/providers/00000000-0000-4000-8000-000000000002/passes': () => ok({ items: [] }),
    })
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    // A wallet that sells gets a door into My Store, and the Passes it made
    // previewed behind it — never a claim of provider standing from the session.
    expect(await screen.findByRole('link', { name: /View all Passes/i })).toHaveAttribute(
      'href',
      '/my-store',
    )
  })

  it('previews at most three created Passes and sends the rest to My Store', async () => {
    const made = (index: number) =>
      aPass({
        id: `50000000-0000-4000-8000-00000000000${index}`,
        title: `Pass ${index}`,
      })

    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [aProvider()] }),
      '/api/v1/providers/00000000-0000-4000-8000-000000000002/passes': () =>
        ok({ items: [made(1), made(2), made(3), made(4)] }),
    })
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    // Profile is a preview, not a second store.
    expect(await screen.findByText('Pass 1')).toBeInTheDocument()
    expect(screen.getByText('Pass 3')).toBeInTheDocument()
    expect(screen.queryByText('Pass 4')).not.toBeInTheDocument()
  })

  it('offers logging out as the destructive action it is', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    // Colour never carries it alone (docs/03-DESIGN-SYSTEM.md §19), but the
    // danger tone has to actually be there: this is the one way out of the
    // account, and it used to look like every other secondary button.
    const logout = await screen.findByRole('button', { name: /Log out/i })
    expect(logout.className).toContain('bg-danger')
  })

  it('does not claim provider standing for an identity that owns none', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    expect(await screen.findByRole('link', { name: /Create a Pass/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Your Passes/i })).not.toBeInTheDocument()
  })

  it('warns when the wallet no longer matches the logged-in identity', async () => {
    mockApi({
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })
    renderApp('/profile', {
      wallet: stubWallet({ account: 'NQ55 0000 0000 0000 0000 0000 0000 0000 0099' }),
      session: stubSession(),
    })

    expect(await screen.findByText("You've switched wallets")).toBeInTheDocument()
    expect(screen.getByText(/payments and session codes will be refused/i)).toBeInTheDocument()
  })

  it('logs out through the backend and returns to the homepage', async () => {
    const { calls } = mockApi({
      // The real SessionProvider, so this is the actual logout call.
      'GET /api/v1/auth/session': () => ok(stubSession()),
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
      '/api/v1/public/passes': () => ok({ items: [] }),
      // Logout is DELETE /auth/session — the session resource, not an action.
      'DELETE /api/v1/auth/session': () => noContent(),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/profile', { wallet: stubWallet() })

    await user.click(await screen.findByRole('button', { name: /Log out/ }))

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === 'DELETE' && call.url === '/api/v1/auth/session',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { name: /Buy a pass once/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: "You're not logged in" })).not.toBeInTheDocument()
  })

  it('stays on Profile when logout cannot be confirmed', async () => {
    mockApi({
      'GET /api/v1/auth/session': () => ok(stubSession()),
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
      'DELETE /api/v1/auth/session': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const user = userEvent.setup()
    const { router } = renderApp('/profile', { wallet: stubWallet() })

    await user.click(await screen.findByRole('button', { name: /Log out/ }))

    expect(
      await screen.findByText(/Logout could not be confirmed/i),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profile')
    expect(screen.getByRole('button', { name: /Log out/ })).toBeInTheDocument()
  })
})

/**
 * The face a provider shows is theirs to pick, and it is stored rather than
 * rendered from whoever is looking.
 *
 * Nimiq has no catalogue of ready-made avatars — an identicon is generated
 * from a string — so the options are identicons of this wallet's own address,
 * and only the chosen number travels to the backend.
 */
describe('choosing a face on Profile', () => {
  const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'

  function workspace(provider = aProvider({ id: PROVIDER_ID, name: 'Emin Kutlu' })) {
    return {
      '/api/v1/passes': () => ok(aPurchasedPassPage([])),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [provider] }),
      [`/api/v1/providers/${PROVIDER_ID}/passes`]: () => ok({ items: [] }),
    }
  }

  it('sends only the chosen variant, and not until the profile is saved', async () => {
    const { calls } = mockApi({
      ...workspace(),
      [`PATCH /api/v1/providers/${PROVIDER_ID}`]: () =>
        ok(aProvider({ id: PROVIDER_ID, name: 'Emin Kutlu', avatarVariant: 3 })),
    })
    const user = userEvent.setup()
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    expect(await screen.findByRole('textbox', { name: /Display name/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Headline/i })).toBeInTheDocument()

    const nameField = screen.getByRole('textbox', { name: /Display name/i })
    const ownFace = await screen.findByRole('radio', { name: 'Your wallet identicon' })
    expect(nameField.compareDocumentPosition(ownFace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(await screen.findByRole('radio', { name: 'Identicon 4' }))

    // Picking is not publishing: nothing is written until Save.
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => {
      const patch = calls.find((call) => call.method === 'PATCH')
      expect(patch?.body).toMatchObject({ name: 'Emin Kutlu', avatarVariant: 3 })
    })
  })

  it('offers the wallet\'s own identicon first, and more faces on request', async () => {
    mockApi(workspace())
    const user = userEvent.setup()
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    // Variant 0 is the wallet's own face — the default every provider has.
    const own = await screen.findByRole('radio', { name: 'Your wallet identicon' })
    expect(own).toHaveAttribute('aria-checked', 'true')

    const before = screen.getAllByRole('radio').length
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(before)

    const showMore = screen.getByRole('button', { name: 'Show more' })
    const showLess = screen.getByRole('button', { name: 'Show less' })
    expect(showMore.parentElement).toBe(showLess.parentElement)

    await user.click(showLess)
    expect(screen.getAllByRole('radio')).toHaveLength(before)
    expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument()
  })

  it('starts from the face already stored, not from the default', async () => {
    mockApi(workspace(aProvider({ id: PROVIDER_ID, name: 'Emin Kutlu', avatarVariant: 5 })))
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    expect(await screen.findByRole('radio', { name: 'Identicon 6' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Your wallet identicon' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })
})


/**
 * A section that renders nothing is indistinguishable from a section that was
 * never built — and that is exactly how these two states were read from inside
 * Nimiq Pay, where "Public profile is missing on mobile" was a wallet with no
 * provider record and a request that had failed, not a layout that dropped it.
 *
 * Nothing here is device-specific: Profile is one page at every width, and the
 * only thing that decides what "Public profile" shows is the provider record
 * the backend returns (docs/09-SECURITY.md §33, §67-§68).
 */
describe('Public profile when there is no record to edit', () => {
  const base = {
    '/api/v1/passes': () => ok(aPurchasedPassPage([])),
    '/api/v1/purchases': () => ok({ items: [] }),
  }

  it('says the wallet has no public profile instead of dropping the section', async () => {
    mockApi({ ...base, '/api/v1/providers': () => ok({ items: [] }) })
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    // The heading alone proves nothing: the loading skeleton wears it too.
    expect(await screen.findByText(/no public profile yet/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Public profile' })).toBeInTheDocument()
    // The one Create a Pass button belongs to "Selling on Nimpass" below it.
    expect(screen.getAllByRole('link', { name: /Create a Pass/i })).toHaveLength(1)
  })

  it('reports a failed provider load rather than hiding the section', async () => {
    mockApi({ ...base, '/api/v1/providers': () => domainError(500, 'INTERNAL') })
    renderApp('/profile', { wallet: stubWallet(), session: stubSession() })

    // Scoped to this section: "Selling on Nimpass" reports the same failed
    // request just below, so the page holds two alerts and only one of them
    // is evidence that this section survived.
    //
    // `ErrorState` offers a retry only for network failures; a 500 is reported
    // as itself. Either way the section stays on the page and says so.
    await waitFor(() => {
      const section = screen.getByRole('heading', { name: 'Public profile' }).closest('section')
      expect(within(section as HTMLElement).getByRole('alert')).toHaveTextContent(
        /something went wrong/i,
      )
    })
  })
})
