import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { anOffer, mockApi, ok } from '@/test/mock-api'
import { aPurchase } from '@/test/fixtures'

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
