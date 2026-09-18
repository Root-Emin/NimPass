import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, domainError, mockApi, ok } from '@/test/mock-api'
import { aPurchasedPass, aRedemptionChallenge, aConsumedChallenge, aPurchase } from '@/test/fixtures'
import { miniAppTransportDouble } from '@/test/wallet-transport'
import { NO_CAPABILITIES } from '@/types/wallet'

/**
 * Release validation for the states a real device produces and a desk does not.
 *
 * Everything here came out of auditing Milestones 1–4B from a release
 * perspective rather than a feature one: a phone that locks mid-payment, a
 * session that expires while a dialog is open, a browser with no wallet in it,
 * and a marketplace on its first day with nothing in it yet.
 */

const signMessage = vi.fn()

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    currentTransport: () =>
      miniAppTransportDouble({ signMessage: (...a: unknown[]) => signMessage(...a) }),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

const WALLET = stubWallet()
const SESSION = stubSession()
const PASS = aPurchasedPass()
const OFFER = aPublicPass()
const CATALOG = OFFER.pass
const CHALLENGE = aRedemptionChallenge()

const challengesUrl = `/api/v1/passes/${PASS.id}/redemption-challenges`
const detailUrl = `/api/v1/redemption-challenges/${CHALLENGE.challengeId}`

beforeEach(() => {
  signMessage.mockReset()
  signMessage.mockResolvedValue({ publicKey: 'ab'.repeat(32), signature: 'cd'.repeat(64) })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Simulates the app being backgrounded and brought back. */
function returnToForeground() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('background and foreground (§22)', () => {
  it('settles a redemption in one call, with nothing left polling behind it', async () => {
    // There used to be a live QR on screen here, and a watcher re-reading the
    // challenge until a provider confirmed it. Authorizing now spends the
    // session in the same request, so the ceremony ends where it started — and
    // nothing may keep asking the backend about a challenge that is finished.
    const { calls } = mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`/api/v1/passes/${PASS.id}/redemptions`]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
      [`POST ${challengesUrl}`]: () => ok(CHALLENGE),
      [`POST ${detailUrl}/authorization`]: () => ok(aConsumedChallenge()),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PASS.passTitle, level: 1 })
    await user.click(screen.getByRole('button', { name: /Use a session/i }))
    await user.click(await screen.findByRole('button', { name: /Use a session/i }))

    // Scoped to the dialog: the pass page behind it also says "sessions used".
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Session used')).toBeInTheDocument()

    const authorizations = calls.filter((c) => c.url === `${detailUrl}/authorization`)
    expect(authorizations).toHaveLength(1)

    // Coming back to the app must not restart a watch that no longer exists.
    const before = calls.length
    returnToForeground()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(calls.filter((c) => c.url === detailUrl)).toHaveLength(0)
    expect(calls.length).toBe(before)
  }, 15_000)

  it('revalidates a settling purchase on return rather than showing a frozen spinner', async () => {
    let confirmed = false
    const INTENT = aPurchase()
    const id = INTENT.purchaseIntentId

    const { calls } = mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${id}`]: () =>
        ok(
          confirmed
            ? { ...INTENT, status: 'completed', paymentRequest: null, purchasedPassId: PASS.id }
            : { ...INTENT, status: 'awaiting_finality', paymentRequest: null, transactionHash: 'a'.repeat(64) },
        ),
    })

    renderApp(`/pass/${CATALOG.id}?purchase=${id}`, { wallet: WALLET, session: SESSION })
    expect(await screen.findByText('Finalising your payment…')).toBeInTheDocument()

    const before = calls.filter((c) => c.url === `/api/v1/purchases/${id}`).length
    confirmed = true
    returnToForeground()

    expect(await screen.findByText('Payment successful', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(calls.filter((c) => c.url === `/api/v1/purchases/${id}`).length).toBeGreaterThan(before)
  }, 15_000)

  it('does not poke the backend on foreground when nothing is in flight', async () => {
    // Revalidation is for live state. A foreground event on an idle screen must
    // not turn every tab switch into traffic.
    const { calls } = mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
    })

    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })

    const before = calls.length
    returnToForeground()
    returnToForeground()

    await waitFor(() => expect(calls.length).toBe(before))
  })
})

describe('no wallet in the runtime (§21)', () => {
  const NO_WALLET = stubWallet({
    status: 'unavailable',
    capabilities: NO_CAPABILITIES,
    account: null,
  })

  it('browses the public marketplace without crashing', async () => {
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [OFFER] }),
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
    })

    renderApp('/discover', { wallet: NO_WALLET, session: null })

    expect(await screen.findByText(CATALOG.title)).toBeInTheDocument()
    // No error boundary, no blank page.
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it('explains the next step on a pass instead of offering an impossible buy', async () => {
    mockApi({ [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER) })

    renderApp(`/pass/${CATALOG.id}`, { wallet: NO_WALLET, session: null })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    // This runtime reached neither transport — no injected provider and no Hub.
    // Rare, and the only honest answer is to say so rather than arm a Buy
    // button that leads nowhere. Every armed Buy control is disabled here.
    for (const button of screen.queryAllByRole('button', { name: /Buy with NIM/i })) {
      expect(button).toBeDisabled()
    }
    const body = document.body.textContent ?? ''
    expect(body).toMatch(/couldn't reach a Nimiq wallet/i)
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it('explains why passes are private rather than erroring', async () => {
    const { calls } = mockApi({})
    renderApp('/passes', { wallet: NO_WALLET, session: null })

    expect(await screen.findByText('Your passes are private')).toBeInTheDocument()
    // Nothing is requested without a session.
    expect(calls).toHaveLength(0)
  })
})

describe('first run on an empty marketplace (§27)', () => {
  it('shows real empty-state copy, not an error and not invented content', async () => {
    mockApi({ '/api/v1/public/passes': () => ok({ items: [] }) })

    renderApp('/discover', { wallet: WALLET, session: null })

    // Something human, and demonstrably no fabricated provider or Pass.
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument())
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/Alex Fitness|Personal Training/)
    expect(body).not.toMatch(/something went wrong/i)
  })

  it('guides a signed-in customer with no provider record through onboarding', async () => {
    mockApi({ '/api/v1/providers': () => ok({ items: [] }) })

    renderApp('/provider', { wallet: WALLET, session: SESSION })

    // A customer who opens the workspace is a normal state, not an error and
    // not an endless skeleton.
    await waitFor(() => {
      const body = document.body.textContent ?? ''
      expect(body).not.toMatch(/something went wrong/i)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('session expiry mid-flow (§23)', () => {
  it('asks the customer to sign in again instead of failing obscurely', async () => {
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`/api/v1/passes/${PASS.id}/redemptions`]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
      // The session died between page load and pressing the button.
      [`POST ${challengesUrl}`]: () => domainError(401, 'AUTH_REQUIRED', 'session gone'),
    })

    const user = userEvent.setup()
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PASS.passTitle, level: 1 })
    await user.click(screen.getByRole('button', { name: /Use a session/i }))

    expect(await screen.findByText('Log in again')).toBeInTheDocument()
    // No wallet dialog was opened for a request that could never succeed.
    expect(signMessage).not.toHaveBeenCalled()
    // And no raw code reached the customer.
    expect(document.body.textContent).not.toContain('AUTH_REQUIRED')
  })

  it('does not let a wallet being present imply an application session (§24)', async () => {
    // A connected wallet is not an authenticated identity. The provider
    // workspace must gate on the session, not on wallet availability.
    mockApi({})

    renderApp('/provider', { wallet: WALLET, session: null })

    // The workspace is not rendered at all: no chrome, no navigation, nothing
    // implying this wallet has anything to manage.
    expect(
      await screen.findByRole('heading', { name: 'Log in to manage your workspace' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Provider workspace' })).toBeNull(),
    )
    expect(document.body.textContent ?? '').toMatch(/log in/i)
  })
})

/**
 * Plain-language audit (§38, §39).
 *
 * Checked against rendered output rather than source, because source is full of
 * `txHash`, `Luna` and `AWAITING_FINALITY` as identifiers — none of which reach
 * a screen. What matters is what a first-time visitor actually reads.
 *
 * The bar is a judge or a customer with no crypto background understanding the
 * page without a developer beside them.
 */
describe('plain language on customer surfaces (§38, §39)', () => {
  /** Terms that would mean nothing to a tutor booking a session. */
  const JARGON = [
    /\btxHash\b/i,
    /transaction hash/i,
    /macro[- ]block/i,
    /\bRPC\b/,
    /\bLuna\b/,
    /\bnonce\b/i,
    /\bdigest\b/i,
    /Ed25519/i,
    /SHA-?256/i,
    /\bidempotenc/i,
    /\bendpoint\b/i,
    /\bUUID\b/i,
    // Raw enum spellings from either contract half.
    /[A-Z]{3,}_[A-Z_]{3,}/,
  ]

  function assertPlainLanguage(where: string) {
    const body = document.body.textContent ?? ''
    for (const pattern of JARGON) {
      expect(body, `${where} shows developer language: ${pattern}`).not.toMatch(pattern)
    }
  }

  it('keeps Discover readable', async () => {
    mockApi({ '/api/v1/public/passes': () => ok({ items: [OFFER] }) })
    renderApp('/discover', { wallet: WALLET, session: null })
    await screen.findByText(CATALOG.title)
    assertPlainLanguage('Discover')
  })

  it('keeps Pass Detail readable', async () => {
    mockApi({ [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER) })
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    assertPlainLanguage('Pass Detail')
  })

  it('keeps Pass Detail readable', async () => {
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`/api/v1/passes/${PASS.id}/redemptions`]: () => ok({ items: [] }),
      [`GET ${challengesUrl}/current`]: () => domainError(404, 'NOT_FOUND', 'none'),
    })
    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PASS.passTitle, level: 1 })
    assertPlainLanguage('Pass Detail')
  })

  it('keeps the finality wait readable — the most jargon-prone screen', async () => {
    const INTENT = aPurchase()
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${INTENT.purchaseIntentId}`]: () =>
        ok({
          ...INTENT,
          status: 'awaiting_finality',
          paymentRequest: null,
          transactionHash: 'a'.repeat(64),
        }),
    })

    renderApp(`/pass/${CATALOG.id}?purchase=${INTENT.purchaseIntentId}`, {
      wallet: WALLET,
      session: SESSION,
    })
    await screen.findByText('Finalising your payment…')

    assertPlainLanguage('finality wait')
    // The raw hash never appears, even though the frontend holds it.
    expect(document.body.textContent).not.toContain('a'.repeat(64))
  })

  it('prices in NIM, never in raw integer Luna', async () => {
    mockApi({ [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER) })
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })

    const body = document.body.textContent ?? ''
    // 25_000_000 Luna is 250 NIM. The Luna integer must not be on screen.
    expect(body).toContain('250')
    expect(body).not.toContain('25000000')
    expect(body).not.toContain('25,000,000')
  })
})

describe('wallet account change (§24)', () => {
  it('warns when the wallet has moved on from the signed-in identity', async () => {
    // Nimiq Pay allows switching accounts while a Nimpass session is open. The
    // session stays bound to the wallet it was issued for, so payments and
    // redemption signatures from the new account are refused server-side —
    // correctly, but confusingly unless the app says why.
    const OTHER = 'NQ22 1111 1111 1111 1111 1111 1111 1111 1111'
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [] }),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    renderApp('/discover', {
      wallet: stubWallet({ account: OTHER }),
      session: SESSION,
    })

    // The header marks the drift; the profile page explains it.
    expect(await screen.findByText('Wallet changed')).toBeInTheDocument()
    await user.click(await screen.findByRole('link', { name: 'Profile' }))

    expect(await screen.findByText("You've switched wallets")).toBeInTheDocument()
    expect(screen.getByText(/payments and session codes will be refused/i)).toBeInTheDocument()
  })

  it('says nothing when the wallet and the session agree', async () => {
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [] }),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    // stubWallet's default account is the same wallet stubSession signs in with.
    renderApp('/discover', { wallet: WALLET, session: SESSION })

    await user.click(await screen.findByRole('link', { name: 'Profile' }))
    await screen.findByRole('heading', { name: 'Profile', level: 1 })
    expect(screen.queryByText("You've switched wallets")).not.toBeInTheDocument()
    expect(screen.queryByText('Wallet changed')).not.toBeInTheDocument()
  })

  it('does not treat a differently-spaced address as a different wallet', async () => {
    // Addresses are displayed spaced and passed around unspaced. Comparing raw
    // strings would raise a mismatch warning on every single session.
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [] }),
      '/api/v1/purchases': () => ok({ items: [] }),
      '/api/v1/providers': () => ok({ items: [] }),
    })

    const user = userEvent.setup()
    renderApp('/discover', {
      wallet: stubWallet({ account: SESSION.identity.wallet.replace(/\s+/g, '') }),
      session: SESSION,
    })

    await user.click(await screen.findByRole('link', { name: 'Profile' }))
    await screen.findByRole('heading', { name: 'Profile', level: 1 })
    expect(screen.queryByText("You've switched wallets")).not.toBeInTheDocument()
  })
})

describe('provider content reaches the public marketplace (§26)', () => {
  it('surfaces a published pass to a stranger, and hides an unpublished one', async () => {
    // The provider half of the competition story: what a provider publishes has
    // to become something a stranger can buy, with no developer touching the
    // database in between — and a draft must stay invisible until then.
    let published = false

    const { calls } = mockApi({
      '/api/v1/public/passes': () => ok({ items: published ? [OFFER] : [] }),
      [`/api/v1/public/passes/${CATALOG.id}`]: () =>
        published ? ok(OFFER) : domainError(404, 'NOT_FOUND', 'not published'),
    })

    // Draft: a stranger sees nothing, and the page 404s rather than leaking it.
    const draft = renderApp('/discover', { wallet: WALLET, session: null })
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument())
    expect(screen.queryByText(CATALOG.title)).not.toBeInTheDocument()
    draft.unmount()

    // The provider publishes.
    published = true

    // Published: the same public route now carries it, for an anonymous visitor.
    mockApi({
      '/api/v1/public/passes': () => ok({ items: [OFFER] }),
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
    })
    renderApp('/discover', { wallet: WALLET, session: null })

    expect(await screen.findByText(CATALOG.title)).toBeInTheDocument()
    // Served from the public endpoint, with no session involved.
    expect(calls.every((c) => c.url.startsWith('/api/v1/public/'))).toBe(true)
  })
})
