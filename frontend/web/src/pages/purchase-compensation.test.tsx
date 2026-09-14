import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { anOffer, mockApi, ok } from '@/test/mock-api'
import { aCompensationPurchase, aPass, aPurchase } from '@/test/fixtures'

/**
 * The compensation path, end to end.
 *
 * A customer pays. The transaction is verified and macro-finalised. The package
 * reaches its fixed expiration before the pass can be activated, so the backend
 * commits the receipt and opens a compensation case instead of issuing an
 * entitlement — `COMPENSATION_REQUIRED`, with no pass and no refund.
 *
 * That is the most dangerous screen in the product. The customer has paid, has
 * nothing to show for it, and the single most natural reaction — pay again — is
 * the one the app must make impossible. Everything below tests that, from the
 * moment the state arrives to what the customer finds when they reopen the app
 * days later.
 *
 * Nimiq Pay is doubled at the adapter boundary; the backend is stubbed at
 * `fetch`, so the real API client, the real state mapping and the real routes
 * all run. No component is handed a compensation state directly — every one
 * below is produced by the stubbed backend and read back through the flow.
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
const COMPENSATED = aCompensationPurchase({ transactionHash: TX_HASH })

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

function buyButtons() {
  return screen.queryAllByRole('button', { name: /Buy with NIM/i })
}

/** Backend that verifies the payment and then reports a compensation case. */
function compensatingBackend() {
  const statuses = ['verifying', 'awaiting_finality', 'compensation_required'] as const
  let polls = 0

  return mockApi({
    [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
    'POST /api/v1/purchases': () => ok(INTENT, 201),
    [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
      ok({ ...INTENT, status: 'transaction_submitted', paymentRequest: null, transactionHash: TX_HASH }, 202),
    [`/api/v1/purchases/${PURCHASE_ID}`]: () => {
      const status = statuses[Math.min(polls++, statuses.length - 1)]!
      return status === 'compensation_required'
        ? ok(COMPENSATED)
        : ok({ ...INTENT, status, paymentRequest: null, transactionHash: TX_HASH })
    },
  })
}

describe('purchase journey · compensation branch', () => {
  it('carries a verified payment to a compensation case without ever claiming a pass', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)
    const { calls } = compensatingBackend()

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click(buyButtons()[0]!)

    // The wallet was handed the backend's terms, once.
    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1))

    // Awaiting finality is progress, not doubt (§16).
    expect(
      await screen.findByText('Finalising your payment…', {}, { timeout: 6000 }),
    ).toBeInTheDocument()

    // …and then the backend's verdict, in the product's own words (§5).
    expect(
      await screen.findByText(
        'Payment received, but your pass could not be issued',
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument()

    // No pass exists, so nothing offers to open one.
    expect(screen.queryByRole('link', { name: 'View pass' })).not.toBeInTheDocument()
    expect(screen.queryByText('Payment successful')).not.toBeInTheDocument()

    // Exactly one transaction, for the whole journey (§38.4).
    expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1)
    expect(calls.filter((call) => call.url.endsWith('/transactions')).length).toBe(1)
    expect(calls.filter((call) => call.url === '/api/v1/purchases' && call.method === 'POST').length).toBe(1)
  }, 20_000)

  it('disables every Buy control once compensation is reported', async () => {
    // §6: `doNotPayAgain` is a safety contract, not a hint. The controls have to
    // agree with the copy, or the warning beside them is decorative.
    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(COMPENSATED),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    expect(
      await screen.findByText('Payment received, but your pass could not be issued'),
    ).toBeInTheDocument()

    const buttons = buyButtons()
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) expect(button).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
  })

  it('starts no second transaction, however hard the customer tries', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(COMPENSATED),
      'POST /api/v1/purchases': () => ok(INTENT, 201),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    await screen.findByText('Payment received, but your pass could not be issued')

    for (const button of buyButtons()) {
      await user.click(button).catch(() => {})
    }

    // No wallet dialog, and no fresh intent behind the scenes (§38.4).
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
    expect(calls.some((call) => call.url === '/api/v1/purchases' && call.method === 'POST')).toBe(false)
  })

  it('survives a reload with the compensation state intact', async () => {
    // §38.7: local state is gone after a refresh; the purchase id in the URL is
    // the only handle, and the backend is the only source of truth.
    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(COMPENSATED),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    expect(
      await screen.findByText('Payment received, but your pass could not be issued'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Do not pay again/i)).toBeInTheDocument()

    // Recovery reads; it never mints a new intent.
    expect(calls.some((call) => call.url === '/api/v1/purchases' && call.method === 'POST')).toBe(false)
    expect(calls.some((call) => call.url === `/api/v1/purchases/${PURCHASE_ID}`)).toBe(true)
  })

  it('stops polling instead of decaying into "we can\'t tell"', async () => {
    // The regression this guards: compensation is a state the backend never
    // moves on from. A loop that kept polling would eventually hit its timeout
    // and rewrite the state as UNCERTAIN, discarding both the explanation and
    // the receipt (§2).
    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(COMPENSATED),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })
    await screen.findByText('Payment received, but your pass could not be issued')

    const reads = () => calls.filter((call) => call.url === `/api/v1/purchases/${PURCHASE_ID}`).length
    const after = reads()

    await new Promise((resolve) => setTimeout(resolve, 4_000))

    expect(reads()).toBe(after)
    expect(screen.queryByText('Checking your payment…')).not.toBeInTheDocument()
    expect(
      screen.getByText('Payment received, but your pass could not be issued'),
    ).toBeInTheDocument()
  }, 10_000)

  it('is not shown as a failed payment', async () => {
    // §38.8, and the rule the whole milestone turns on: a verified payment is
    // never reported as a failure.
    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(COMPENSATED),
    })

    renderApp(`/packages/${PACKAGE.id}?purchase=${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })
    await screen.findByText('Payment received, but your pass could not be issued')

    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/Payment couldn't be completed/i)
    expect(body).not.toMatch(/payment failed/i)
    expect(body).not.toMatch(/you were not charged/i)
    // …nor as an uncertainty, which it also is not.
    expect(body).not.toMatch(/can't confirm the outcome/i)
  })
})

describe('compensation in My Passes', () => {
  const PASS = aPass()

  it('shows the purchase without inventing a pass for it', async () => {
    // §28: a compensation purchase produced no entitlement. A placeholder pass
    // with a session count would be a fabricated balance.
    mockApi({
      '/api/v1/purchases': () => ok({ items: [COMPENSATED] }),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    expect(
      await screen.findByRole('heading', { name: "Payments we're still resolving" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Payment received, but your pass could not be issued'),
    ).toBeInTheDocument()

    // Nothing claims sessions remain.
    expect(screen.queryByText(/sessions left/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use a session' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /View pass/i })).not.toBeInTheDocument()
  })

  it('keeps the compensation case visible next to real passes', async () => {
    // §29: opening the app days later must not lose the state. Both records
    // exist, and each is rendered as what it is.
    mockApi({
      '/api/v1/purchases': () =>
        ok({ items: [COMPENSATED, aPurchase({ status: 'completed', passId: PASS.id })] }),
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
    })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    const unresolved = await screen.findByRole('heading', {
      name: "Payments we're still resolving",
    })
    expect(unresolved).toBeInTheDocument()

    // The genuine pass is still a pass, with its real remaining count.
    expect(await screen.findByText(/of 10 sessions left/)).toBeInTheDocument()

    // The compensation row links back to its purchase, not to a pass.
    const section = unresolved.closest('section')!
    const link = within(section).getByRole('link', { name: 'Open this purchase' })
    expect(link).toHaveAttribute(
      'href',
      `/packages/${COMPENSATED.packageId}?purchase=${COMPENSATED.purchaseIntentId}`,
    )
  })

  it('does not report "no passes yet" when a payment is unresolved', async () => {
    mockApi({ '/api/v1/purchases': () => ok({ items: [COMPENSATED] }) })

    renderApp('/passes', { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: "Payments we're still resolving" })
    expect(screen.queryByText('No passes yet')).not.toBeInTheDocument()
  })
})
