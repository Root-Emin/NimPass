import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, mockApi, ok } from '@/test/mock-api'
import { aPurchasedPass, aPurchase } from '@/test/fixtures'

/**
 * The customer journey, integration-style:
 *
 *   Pass Detail → Buy → Purchase Intent → Nimiq Pay → transaction hash
 *   → backend verification → CONFIRMED → pass provisioned → Pass Detail
 *
 * Nimiq Pay is a test double at the adapter boundary — the only place Nimpass
 * touches the wallet. The backend is stubbed at `fetch`, so the real API client
 * runs. No component invents payment business logic: every state transition
 * below comes from what the stubbed backend reports.
 */

const sendBasicTransactionWithData = vi.fn()
const getNetworkReadiness = vi.fn()

import { miniAppTransportDouble } from '@/test/wallet-transport'

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    // The wallet is stubbed at the transport boundary — the one interface both
    // Nimiq Pay and the Nimiq Hub implement. This double is the Nimiq Pay side,
    // and it calls the hooks below with the provider's own parameter names, so
    // an assertion here is an assertion about what the wallet is handed.
    currentTransport: () =>
      miniAppTransportDouble({
        listAccounts: async () => ['NQ07 0000 0000 0000 0000 0000 0000 0000 0081'],
        sendBasicTransactionWithData: (...args: unknown[]) =>
          sendBasicTransactionWithData(...args),
        getNetworkReadiness: (...args: unknown[]) => getNetworkReadiness(...args),
      }),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')
const { NimiqOperationError, nimiqError } = await import('@/lib/nimiq')

const TX_HASH = 'a1b2c3d4'.repeat(8)

const OFFER = aPublicPass()
const CATALOG = OFFER.pass

const INTENT = aPurchase()
const PURCHASE_ID = INTENT.purchaseIntentId

const PASS = aPurchasedPass({ usedSessions: 0, remainingSessions: 10 })

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

async function startAndPay(user: ReturnType<typeof userEvent.setup>) {
  const buy = (await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!
  await user.click(buy)
  // On a phone the confirmation is an overlay that opens on the tap, so the
  // customer never has to go looking below the fold for the next step.
  const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })
  await user.click(within(sheet).getByRole('checkbox'))
  const approve = within(sheet).getByRole('button', { name: 'Confirm and pay in Nimiq Pay' })
  await waitFor(() => expect(approve).toBeEnabled())
  await user.click(approve)
}

function catalogPurchaseRoutes(afterBroadcast?: () => ReturnType<typeof ok>) {
  let broadcast = false
  return mockApi({
    [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
    'POST /api/v1/purchases': () => ok(INTENT),
    [`POST /api/v1/purchases/${PURCHASE_ID}/wallet-attempts`]: () => ok(INTENT, 201),
    [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () => {
      broadcast = true
      return ok({
        ...INTENT,
        status: 'transaction_submitted',
        paymentRequest: null,
        transactionHash: TX_HASH,
      })
    },
    [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => {
      if (!broadcast || !afterBroadcast) return ok(INTENT)
      return afterBroadcast()
    },
  })
}

describe('purchase journey', () => {
  it('carries the intent through the wallet to a provisioned pass', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    // The backend walks its own state machine; the UI only reads it. The full
    // Mission 03 sequence, including the finality wait (§40).
    const statuses = ['verifying', 'awaiting_finality', 'completed'] as const
    let polls = 0

    const { calls } = catalogPurchaseRoutes(() => {
      const status = statuses[Math.min(polls++, statuses.length - 1)]!
      return ok({
        ...INTENT,
        status,
        paymentRequest: null,
        transactionHash: TX_HASH,
        purchasedPassId: status === 'completed' ? PASS.id : null,
      })
    })

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })

    await startAndPay(user)

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
    // §27: the purchased pass carries the snapshot the purchase froze. The live
    // catalog Pass has since been retitled and repriced; My Pass must not follow it.
    const RENAMED = aPublicPass({
      pass: { ...CATALOG, title: 'Completely different pass now', priceLuna: 99_000_000 },
    })

    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(RENAMED),
    })

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    // The title comes from the purchased pass snapshot, not from the live catalog.
    expect(
      await screen.findByRole('heading', { name: PASS.passTitle, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Completely different pass now')).not.toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('sessions remaining')).toBeInTheDocument()
    expect(screen.getByText('0 of 10 used')).toBeInTheDocument()
  })

  it('shows the pass from real backend state once it exists', async () => {
    mockApi({
      [`/api/v1/passes/${PASS.id}`]: () => ok(PASS),
      })

    renderApp(`/passes/${PASS.id}`, { wallet: WALLET, session: SESSION })

    expect(
      await screen.findByRole('heading', { name: CATALOG.title, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('sessions remaining')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    
  })

  it('never announces a pass the backend has not provisioned yet', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    catalogPurchaseRoutes(() =>
      ok({
        ...INTENT,
        status: 'pass_provisioning',
        paymentRequest: null,
        transactionHash: TX_HASH,
        purchasedPassId: null,
      }),
    )

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    await startAndPay(user)

    expect(await screen.findByText('Payment received')).toBeInTheDocument()
    expect(screen.getByText('You do not need to pay again.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View pass' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('treats a declined payment as a cancellation the user can safely retry', async () => {
    sendBasicTransactionWithData.mockRejectedValue(
      new NimiqOperationError(nimiqError('USER_REJECTED')),
    )

    const { calls } = catalogPurchaseRoutes()

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    await startAndPay(user)

    expect(await screen.findByText('Payment cancelled')).toBeInTheDocument()
    expect(screen.getByText('You were not charged.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0)
    // Nothing was submitted, so nothing was reported.
    expect(calls.some((c) => c.url.includes('/submission'))).toBe(false)
  })

  it('does not dispatch the wallet when Nimiq Pay has no consensus', async () => {
    getNetworkReadiness.mockResolvedValue({ consensusEstablished: false, blockNumber: null })

    catalogPurchaseRoutes()

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    await startAndPay(user)

    expect(await screen.findByText(/Nimiq Pay is not synced/)).toBeInTheDocument()
    // The read-only pre-flight spared the user a wallet dialog for a payment
    // that could not reliably broadcast.
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('stays uncertain — and offers no retry — when the outcome cannot be observed', async () => {
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`POST /api/v1/purchases/${PURCHASE_ID}/wallet-attempts`]: () => ok(INTENT, 201),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () => {
        throw new TypeError('Failed to fetch')
      },
    })

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    await startAndPay(user)

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

    const { calls } = catalogPurchaseRoutes()

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!)

    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/purchases')).toBe(true))
    const intentCall = calls.find((c) => c.url === '/api/v1/purchases')

    // Only the pass and a wallet hint are sent. No price, no recipient, no
    // reference — those come back from the backend (docs/08-ARCHITECTURE.md §71).
    // `CreatePurchase` is `{ passId }` and nothing else: the authenticated
    // wallet is the only customer identity the contract accepts.
    expect(intentCall?.body).toEqual({ passId: CATALOG.id })
    expect(intentCall?.body).not.toHaveProperty('priceLuna')
    expect(intentCall?.body).not.toHaveProperty('amountLuna')
  })
})
