import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { anOffer, domainError, mockApi, ok } from '@/test/mock-api'
import { aCompensationPurchase, aPurchase } from '@/test/fixtures'

/**
 * Payment safety under interruption.
 *
 * Every case here is one of the ways a customer ends up paying twice, and each
 * is named as a rule in docs/05-NIMIQ-PAY-INTEGRATION.md: never offer a second
 * payment once a transaction may exist (§55), never call an unknown outcome a
 * failure (§62), and recover an in-flight purchase on refresh rather than
 * starting a new one (§66, §138).
 */

const sendBasicTransactionWithData = vi.fn()
const getNetworkReadiness = vi.fn()

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    sendBasicTransactionWithData: (...args: unknown[]) => sendBasicTransactionWithData(...args),
    getNetworkReadiness: (...args: unknown[]) => getNetworkReadiness(...args),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

const TX_HASH = 'a1b2c3d4'.repeat(8)
const OFFER = anOffer()
const PACKAGE = OFFER.package

const INTENT = aPurchase()
const PURCHASE_ID = INTENT.purchaseIntentId

const WALLET = stubWallet()
const SESSION = stubSession()

beforeEach(() => {
  sendBasicTransactionWithData.mockReset()
  getNetworkReadiness.mockReset()
  getNetworkReadiness.mockResolvedValue({ consensusEstablished: true, blockNumber: 100 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Every "Buy with NIM" control on the page, panel and sticky bar alike. */
function buyButtons() {
  return screen.queryAllByRole('button', { name: /Buy with NIM/i })
}

describe('no second payment while one may already exist', () => {
  it('locks the Buy button once the outcome is uncertain', async () => {
    // Wallet broadcast, then the backend became unreachable: the worst case,
    // because a transaction exists and nothing can confirm it.
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () => {
        throw new TypeError('Failed to fetch')
      },
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => {
        throw new TypeError('Failed to fetch')
      },
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    expect(await screen.findByText('Checking your payment…')).toBeInTheDocument()

    // The copy says "do not send another payment yet" — the control has to
    // agree with it, or the warning is decorative (docs/05 §55).
    for (const button of buyButtons()) expect(button).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('never falls back to "Ready to pay" after the wallet has broadcast', async () => {
    // The submission report is lost, so the backend still reports CREATED even
    // though a transaction is on its way. Mapping that status literally would
    // re-arm the Buy button (docs/05 §61-§62).
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () => {
        throw new TypeError('Failed to fetch')
      },
      // Backend never learned about the hash.
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    expect(await screen.findByText('Checking your payment…')).toBeInTheDocument()
    expect(screen.queryByText('Ready to pay')).not.toBeInTheDocument()
    for (const button of buyButtons()) expect(button).toBeDisabled()
  })

  it('does not open a second wallet dialog when Buy is pressed twice', async () => {
    let releaseWallet: ((hash: string) => void) | undefined
    sendBasicTransactionWithData.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseWallet = resolve
        }),
    )

    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        ok({ ...INTENT, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok({ ...INTENT, status: 'verifying', paymentRequest: null }),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    const buy = buyButtons()[0]!
    await user.click(buy)

    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1))

    // Second press while the native sheet is open.
    await user.click(buy).catch(() => {})
    expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1)

    releaseWallet?.(TX_HASH)
  })
})

describe('purchase recovery across a reload', () => {
  it('puts the purchase in the URL so it survives a refresh', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        ok({ ...INTENT, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok({ ...INTENT, status: 'verifying', paymentRequest: null }),
    })

    const user = userEvent.setup()
    const { router } = renderApp(`/packages/${PACKAGE.id}`, {
      wallet: WALLET,
      session: SESSION,
    })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    // Without this the purchase id lives only in React memory, and a reload
    // loses the only handle on an in-flight payment (docs/05 §128).
    await waitFor(() => expect(router.state.location.search).toContain(`purchase=${PURCHASE_ID}`))
  })

  it('resumes a verifying purchase instead of offering to pay again', async () => {
    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }),
    })

    // A fresh mount at the recovery URL — exactly what a refresh, a WebView
    // reload, or a return trip from Nimiq Pay produces (docs/05 §66, §138).
    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument()
    for (const button of buyButtons()) expect(button).toBeDisabled()

    // Recovery reads the existing purchase. It must not mint a new one.
    expect(calls.some((call) => call.url === '/api/v1/purchases' && call.method === 'POST')).toBe(
      false,
    )
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('recovers a purchase that completed while the customer was away', async () => {
    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'completed', paymentRequest: null, transactionHash: TX_HASH, passId: '40000000-0000-4000-8000-000000000001' }),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    expect(await screen.findByText('Payment successful')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'View pass' })).toHaveAttribute(
      'href',
      '/passes/40000000-0000-4000-8000-000000000001',
    )
  })

  it('treats an unknown purchase id as nothing to recover, not as a lost payment', async () => {
    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      '/api/v1/purchases/aaaaaaaa-0000-4000-8000-0000000000ff': () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'gone' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=aaaaaaaa-0000-4000-8000-0000000000ff`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })

    // A stale or mistyped link is not evidence that money moved, so alarming
    // the customer about a payment would be false (docs/09-SECURITY.md §96).
    await waitFor(() =>
      expect(screen.queryByText('Checking your payment…')).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(buyButtons()[0]).toBeEnabled())
  })
})

/**
 * The full interruption: pay, walk away, come back.
 *
 * This is the shape of a real Nimiq Pay purchase on a phone. The native
 * approval sheet takes over, the WebView may be reloaded behind it, and the
 * customer returns to a freshly mounted application with no memory of what it
 * was doing. Everything that survives that trip has to come from the URL and
 * the backend — and the one thing that must not survive is any impulse to send
 * a second transaction (§41).
 */
describe('recovery after the wallet round trip', () => {
  const PASS_ID = '40000000-0000-4000-8000-000000000001'

  it('resumes an awaiting-finality purchase and follows it to a pass', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    // The backend's view of this purchase. It sits at awaiting finality until
    // the macro block lands, which the test triggers explicitly rather than
    // counting polls — the point is that the *frontend* re-reads the state, not
    // how many times it happens to ask.
    let finalised = false

    const routes = {
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT, 201),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        ok({ ...INTENT, status: 'transaction_submitted', paymentRequest: null, transactionHash: TX_HASH }, 202),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({
          ...INTENT,
          status: finalised ? 'completed' : 'awaiting_finality',
          paymentRequest: null,
          transactionHash: TX_HASH,
          passId: finalised ? PASS_ID : null,
        }),
    }

    mockApi(routes)

    // 1. Pay.
    const user = userEvent.setup()
    const first = renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(first.router.state.location.search).toContain(`purchase=${PURCHASE_ID}`),
    )

    // 2. The application goes away mid-settlement — a WebView reload, or the
    //    trip out to the native approval sheet and back.
    first.unmount()

    // 3. It comes back at the recovery URL with nothing in memory.
    mockApi(routes)
    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    // The state is re-read from the backend, not restored from local memory.
    expect(await screen.findByText('Finalising your payment…')).toBeInTheDocument()
    for (const button of buyButtons()) expect(button).toBeDisabled()

    // 4. Finality lands, and the next poll picks it up.
    finalised = true
    expect(await screen.findByText('Payment successful', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'View pass' })).toHaveAttribute(
      'href',
      `/passes/${PASS_ID}`,
    )

    // Across both mounts, exactly one transaction was ever sent.
    expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1)
  }, 20_000)

  it('resumes into compensation without offering to pay again', async () => {
    // The other ending of the same journey (§41).
    const COMPENSATED = aCompensationPurchase({ transactionHash: TX_HASH })

    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(COMPENSATED),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    expect(
      await screen.findByText('Payment received, but your pass could not be issued'),
    ).toBeInTheDocument()
    for (const button of buyButtons()) expect(button).toBeDisabled()
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
    expect(calls.some((c) => c.url === '/api/v1/purchases' && c.method === 'POST')).toBe(false)
  })

  it('lets the customer ask for a re-check without risking a payment', async () => {
    // The manual half of reconciliation (§20). Pressing it repeatedly is safe:
    // reconciling re-reads evidence and can never authorise a transaction.
    let reconciles = 0

    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'awaiting_finality', paymentRequest: null, transactionHash: TX_HASH }),
      [`POST /api/v1/purchases/${PURCHASE_ID}/reconcile`]: () => {
        reconciles += 1
        return ok({ ...INTENT, status: 'awaiting_finality', paymentRequest: null, transactionHash: TX_HASH })
      },
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    await screen.findByText('Finalising your payment…')
    await user.click(await screen.findByRole('button', { name: 'Check again' }))

    await waitFor(() => expect(reconciles).toBe(1))
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
    expect(calls.some((c) => c.url === '/api/v1/purchases' && c.method === 'POST')).toBe(false)
    // Still awaiting finality, still no Buy button.
    for (const button of buyButtons()) expect(button).toBeDisabled()
  })
})

/**
 * Submission safety: the three ways a transaction hash can go wrong.
 */
describe('transaction submission', () => {
  it('keeps one idempotency key across an accidental double submit', async () => {
    // §31: a key that changes on every retry defeats the backend's dedupe,
    // which is the mechanism that stops a double click becoming two intents.
    let releaseWallet: ((hash: string) => void) | undefined
    sendBasicTransactionWithData.mockImplementation(
      () => new Promise<string>((resolve) => { releaseWallet = resolve }),
    )

    const { fetchMock } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT, 201),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        ok({ ...INTENT, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }, 202),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'verifying', paymentRequest: null }),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })

    const buy = buyButtons()[0]!
    await user.click(buy)
    await user.click(buy).catch(() => {})

    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1))

    const intentCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).endsWith('/api/v1/purchases') && (init as RequestInit)?.method === 'POST',
    )
    expect(intentCalls).toHaveLength(1)
    const headers = (intentCalls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBeTruthy()

    releaseWallet?.(TX_HASH)
  })

  it('uses the backend answer when the same hash is submitted twice', async () => {
    // §32: the submission is idempotent for the same hash, so a lost response
    // followed by a repeat must render the real state — not a generic conflict.
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)
    let submissions = 0

    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT, 201),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () => {
        submissions += 1
        // Same hash, same answer, every time.
        return ok({ ...INTENT, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }, 202)
      },
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument()
    expect(submissions).toBe(1)
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/conflict/i)
  })

  it('reports a hash already bound elsewhere without suggesting a second payment', async () => {
    // §33: the backend enforces global transaction-hash uniqueness. This is a
    // definite rejection of the hash — and emphatically not evidence that the
    // money stayed put, since the wallet has already broadcast.
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT, 201),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        domainError(409, 'PAYMENT_CONFLICT', 'Payment state conflict'),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'transaction_submitted', paymentRequest: null }),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    expect(await screen.findByText(/Don't send another one/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    for (const button of buyButtons()) expect(button).toBeDisabled()
    expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1)
  })
})

/**
 * The recovery parameter is an identifier, and only ever an identifier.
 *
 * `?purchase=` survives a reload and a WebView remount, which also means it is
 * attacker-controllable: anyone can hand a customer a link with anything in it.
 * It may therefore never become a navigation target, and it may never authorise
 * anything on its own — the backend decides what a purchase id is worth, and
 * answers 404 or 403 for one that is not this customer's (§22, §30).
 */
describe('the recovery parameter is not a redirect', () => {
  it('never navigates to a value taken from the URL', async () => {
    const hostile = 'https://evil.example/steal'

    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      // Whatever the id looks like, it is used to build one API path and
      // nothing else — percent-encoded, so it cannot break out of the path
      // segment it occupies. A non-uuid is simply a purchase the backend does
      // not have.
      [`/api/v1/purchases/${encodeURIComponent(hostile)}`]: () =>
        domainError(404, 'NOT_FOUND', 'gone'),
    })

    const { router } = renderApp(
      `/packages/${PACKAGE.id}?purchase=${encodeURIComponent(hostile)}`,
      { wallet: WALLET, session: SESSION },
    )

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })

    // Still on the package route, on this origin.
    expect(router.state.location.pathname).toBe(`/packages/${PACKAGE.id}`)
    // Every request went to our own API, and the hostile value stayed inside a
    // single encoded path segment rather than becoming a host of its own.
    for (const call of calls) {
      expect(call.url.startsWith('/api/v1/')).toBe(true)
      expect(call.url).not.toContain('//evil.example')
    }
    expect(
      calls.some((call) => call.url === `/api/v1/purchases/${encodeURIComponent(hostile)}`),
    ).toBe(true)
    // A stale or hostile id is nothing to recover — not a lost payment.
    await waitFor(() => expect(buyButtons()[0]).toBeEnabled())
  })

  it('shows nothing to recover for a purchase that is not this customer\'s', async () => {
    // §30: the backend enforces object-level authorisation. 403 and 404 mean
    // the same thing here, and neither is evidence that money moved.
    const OTHERS = 'aaaaaaaa-0000-4000-8000-0000000000ee'

    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${OTHERS}`]: () => domainError(403, 'FORBIDDEN', 'not yours'),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=${OTHERS}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await waitFor(() => expect(buyButtons()[0]).toBeEnabled())
    expect(screen.queryByText('Checking your payment…')).not.toBeInTheDocument()
    expect(screen.queryByText(/could not be issued/i)).not.toBeInTheDocument()
  })
})

/**
 * A spent intent, and the far more dangerous thing that resembles one.
 *
 * The backend binds an idempotency key to the purchase it created, for good:
 * reusing the key answers with that same purchase even long after it expired.
 * That is exactly what stops a double click becoming two intents, and it is
 * also what would strand a customer who cancelled and came back later — every
 * press of Buy handing them the same dead record.
 *
 * So the key may rotate. The whole question is when, and the answer has to be
 * narrow, because a rotation in the wrong state mints a second intent for a
 * payment that may already exist (§19, §31).
 */
describe('a new intent after the old one expired', () => {
  it('starts a fresh intent when the backend returns a spent one', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    const SPENT = aPurchase({ status: 'expired', paymentRequest: null, transactionHash: null })
    const FRESH = aPurchase({ purchaseIntentId: 'aaaaaaaa-0000-4000-8000-00000000000f' })

    const keys: (string | undefined)[] = []
    let creates = 0

    const { fetchMock } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(creates++ === 0 ? SPENT : FRESH, 201),
      [`POST /api/v1/purchases/${FRESH.purchaseIntentId}/transactions`]: () =>
        ok({ ...FRESH, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }, 202),
      [`/api/v1/purchases/${FRESH.purchaseIntentId}`]: () =>
        ok({ ...FRESH, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    // The customer is not stuck: the payment proceeds on the new intent.
    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1))
    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: FRESH.paymentRequest!.recipient,
      value: FRESH.paymentRequest!.valueLuna,
      data: FRESH.paymentRequest!.data,
    })

    for (const [input, init] of fetchMock.mock.calls) {
      if (String(input).endsWith('/api/v1/purchases') && (init as RequestInit)?.method === 'POST') {
        keys.push(((init as RequestInit).headers as Record<string, string>)['Idempotency-Key'])
      }
    }

    // Two creations, two distinct keys — the second is a deliberate new
    // request, not an accidental retry of the first.
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).not.toBe(keys[0])
  })

  it('does not mint a second intent for a purchase that may have been paid', async () => {
    // The dangerous near-miss: the intent expired, but a transaction was
    // submitted against it. Expiry alone is not permission to start again —
    // money may already be on the chain (§19).
    const PAID_BUT_EXPIRED = aPurchase({
      status: 'expired',
      paymentRequest: null,
      transactionHash: TX_HASH,
    })

    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(PAID_BUT_EXPIRED, 200),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(PAID_BUT_EXPIRED),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/v1/purchases' && c.method === 'POST')).toBe(true),
    )

    // Exactly one creation attempt, and no wallet dialog.
    expect(calls.filter((c) => c.url === '/api/v1/purchases' && c.method === 'POST')).toHaveLength(1)
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('leaves a compensation case alone rather than starting over', async () => {
    // The same rule at its most consequential: a verified payment with no pass
    // must never be answered with a fresh intent.
    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(aCompensationPurchase(), 200),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })
    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    expect(
      await screen.findByText('Payment received, but your pass could not be issued'),
    ).toBeInTheDocument()
    expect(calls.filter((c) => c.url === '/api/v1/purchases' && c.method === 'POST')).toHaveLength(1)
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })
})
