import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { anOffer, mockApi, ok } from '@/test/mock-api'
import { aPass, aPurchase } from '@/test/fixtures'

/**
 * The customer journey, integration-style:
 *
 *   Package Detail → Buy → Purchase Intent → Nimiq Pay → transaction hash
 *   → backend verification → CONFIRMED → pass provisioned → Pass Detail
 *
 * Nimiq Pay is a test double at the adapter boundary — the only place Nimpass
 * touches the wallet. The backend is stubbed at `fetch`, so the real API client
 * runs. No component invents payment business logic: every state transition
 * below comes from what the stubbed backend reports.
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
const { NimiqOperationError, nimiqError } = await import('@/lib/nimiq')

const TX_HASH = 'a1b2c3d4'.repeat(8)

const OFFER = anOffer()
const PACKAGE = OFFER.package

const INTENT = aPurchase()
const PURCHASE_ID = INTENT.purchaseIntentId

const PASS = aPass({ usedSessions: 0, remainingSessions: 10 })

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

describe('purchase journey', () => {
  it('carries the intent through the wallet to a provisioned pass', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    // The backend walks its own state machine; the UI only reads it. The full
    // Mission 03 sequence, including the finality wait (§40).
    const statuses = ['verifying', 'awaiting_finality', 'completed'] as const
    let polls = 0

    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        ok({ ...INTENT, status: 'transaction_submitted', paymentRequest: null, transactionHash: TX_HASH }),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () => {
        const status = statuses[Math.min(polls++, statuses.length - 1)]!
        return ok({
          ...INTENT,
          status,
          paymentRequest: null,
          transactionHash: TX_HASH,
          passId: status === 'completed' ? PASS.id : null,
        })
      },
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })

    const buy = (await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!
    await user.click(buy)

    // Nimiq Pay received exactly the backend's terms — not the displayed price.
    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalled())
    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: INTENT.paymentRequest!.recipient,
      value: INTENT.paymentRequest!.valueLuna,
      data: INTENT.paymentRequest!.data,
    })

    // The hash is reported as a lookup hint, never as a success claim.
    await waitFor(() =>
      expect(calls.some((c) => c.url === `/api/v1/purchases/${PURCHASE_ID}/transactions`)).toBe(true),
    )
    const submission = calls.find((c) => c.url === `/api/v1/purchases/${PURCHASE_ID}/transactions`)
    expect(submission?.body).toEqual({ txHash: TX_HASH })

    // The first poll reports VERIFYING; success is only announced after the
    // backend reports CONFIRMED with a pass id. The generous timeout covers one
    // real polling interval.
    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument()

    // Awaiting finality is its own step, and reads as progress rather than
    // doubt (§16).
    expect(
      await screen.findByText('Finalising your payment…', {}, { timeout: 6000 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()

    expect(await screen.findByText('Payment successful', {}, { timeout: 8000 })).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: 'View pass' })
    expect(link).toHaveAttribute('href', `/passes/${PASS.id}`)
    expect(polls).toBeGreaterThan(2)
  }, 20_000)

  it('opens the provisioned pass on the terms it was sold under', async () => {
    // §27: the pass carries the snapshot the purchase froze. The live package
    // has since been retitled and repriced; the pass must not follow it.
    const RENAMED = anOffer({
      package: { ...PACKAGE, title: 'Completely different package now', priceLuna: 99_000_000 },
    })

    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(RENAMED),
    })

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    // The title comes from the pass's own snapshot, not from the live package.
    expect(
      await screen.findByRole('heading', { name: PASS.packageTitle, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Completely different package now')).not.toBeInTheDocument()
    expect(screen.getByText(/of 10 sessions left/)).toBeInTheDocument()
  })

  it('shows the pass from real backend state once it exists', async () => {
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      })

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    expect(
      await screen.findByRole('heading', { name: PACKAGE.title, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText(/of 10 sessions left/)).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    
  })

  it('never announces a pass the backend has not provisioned yet', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        ok({ ...INTENT, status: 'transaction_submitted', paymentRequest: null, transactionHash: TX_HASH }),
      // Payment settled, pass not created yet (docs/05 §54).
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'pass_provisioning', paymentRequest: null, transactionHash: TX_HASH, passId: null }),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!)

    expect(await screen.findByText('Payment received')).toBeInTheDocument()
    expect(screen.getByText('You do not need to pay again.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View pass' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('treats a declined payment as a cancellation the user can safely retry', async () => {
    sendBasicTransactionWithData.mockRejectedValue(
      new NimiqOperationError(nimiqError('USER_REJECTED')),
    )

    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!)

    expect(await screen.findByText('Payment cancelled')).toBeInTheDocument()
    expect(screen.getByText('You were not charged.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0)
    // Nothing was submitted, so nothing was reported.
    expect(calls.some((c) => c.url.includes('/submission'))).toBe(false)
  })

  it('does not ask for approval when the wallet has no consensus', async () => {
    getNetworkReadiness.mockResolvedValue({ consensusEstablished: false, blockNumber: null })

    mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!)

    await waitFor(() =>
      expect(screen.getByText("Payment couldn't be completed")).toBeInTheDocument(),
    )
    // The read-only pre-flight spared the user a dialog for a payment the
    // wallet could not reliably broadcast.
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('stays uncertain — and offers no retry — when the outcome cannot be observed', async () => {
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
    await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!)

    expect(await screen.findByText('Checking your payment…')).toBeInTheDocument()
    expect(screen.getByText(/We can't confirm the outcome yet/)).toBeInTheDocument()
    expect(screen.getByText('Do not send another payment.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByText(/couldn't be completed/i)).not.toBeInTheDocument()
    // "Check again" reconciles; it is the one safe action here (§20).
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
  })

  it('binds the intent to the signed-in wallet without claiming control of it', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    const { calls } = mockApi({
      [`/api/v1/public/packages/${PACKAGE.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        ok({ ...INTENT, status: 'transaction_submitted', paymentRequest: null }),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'completed', paymentRequest: null, passId: PASS.id }),
    })

    const user = userEvent.setup()
    renderApp(`/packages/${PACKAGE.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: PACKAGE.title, level: 1 })
    await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!)

    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/purchases')).toBe(true))
    const intentCall = calls.find((c) => c.url === '/api/v1/purchases')

    // Only the package and a wallet hint are sent. No price, no recipient, no
    // reference — those come back from the backend (docs/08-ARCHITECTURE.md §71).
    // `CreatePurchase` is `{ packageId }` and nothing else: the authenticated
    // wallet is the only customer identity the contract accepts.
    expect(intentCall?.body).toEqual({ packageId: PACKAGE.id })
    expect(intentCall?.body).not.toHaveProperty('priceLuna')
    expect(intentCall?.body).not.toHaveProperty('amountLuna')
  })
})
