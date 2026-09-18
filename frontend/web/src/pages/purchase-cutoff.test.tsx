import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aPass, aPublicPass, domainError, livePurchaseRoutes, mockApi, ok } from '@/test/mock-api'
import { aPurchase } from '@/test/fixtures'
import { approveNativePayment } from '@/test/native-pay'

/**
 * The purchase cutoff.
 *
 * A fixed-expiration pass stops accepting *new* purchase intents 35 minutes
 * before it expires — the 30-minute intent TTL plus a five-minute settlement
 * grace — and the backend answers `409 PASS_PURCHASE_CUTOFF`.
 *
 * Two things make this worth its own file. The refusal must read as a reason
 * rather than as a breakage, since nothing went wrong and nobody was charged.
 * And the arithmetic must stay on the server: a frontend that recomputed the
 * cutoff from `expirationAt` would be a second implementation of a money rule,
 * free to disagree with the first — blocking purchases the backend would have
 * accepted, or waving through ones it would refuse (§8).
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

const WALLET = stubWallet()
const SESSION = stubSession()
const TX_HASH = 'a1b2c3d4'.repeat(8)

/** Twenty minutes out: past the cutoff, but the pass has not expired. */
const soon = new Date(Date.now() + 20 * 60_000).toISOString()
const EXPIRING = aPublicPass({ pass: aPass({ expirationAt: soon }) })
const CATALOG = EXPIRING.pass

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

describe('pass purchase cutoff', () => {
  it('explains the refusal instead of showing a generic failure', async () => {
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(EXPIRING),
      'POST /api/v1/purchases': () =>
        domainError(409, 'PASS_PURCHASE_CUTOFF', 'This pass is too close to expiration'),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    await user.click(buyButtons()[0]!)

    expect(await screen.findByText('Too late to buy this pass')).toBeInTheDocument()
    expect(screen.getByText('You have not been charged.')).toBeInTheDocument()

    // Not a payment failure, and not the raw backend sentence (§39).
    expect(screen.queryByText("Payment couldn't be completed")).not.toBeInTheDocument()
    const body = document.body.textContent ?? ''
    expect(body).not.toContain('PASS_PURCHASE_CUTOFF')
    expect(body).not.toContain('This pass is too close to expiration')

    // Nothing reached the wallet, so nothing could have been charged.
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('is not reported as a network problem', async () => {
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(EXPIRING),
      'POST /api/v1/purchases': () => domainError(409, 'PASS_PURCHASE_CUTOFF', 'cutoff'),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    await user.click(buyButtons()[0]!)

    await screen.findByText('Too late to buy this pass')
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/couldn't reach/i)
    expect(body).not.toMatch(/check your connection/i)
    expect(body).not.toMatch(/something went wrong/i)
  })

  it('offers no retry, because the same request would be refused again', async () => {
    const { calls } = mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(EXPIRING),
      'POST /api/v1/purchases': () => domainError(409, 'PASS_PURCHASE_CUTOFF', 'cutoff'),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    await user.click(buyButtons()[0]!)
    await screen.findByText('Too late to buy this pass')

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    for (const button of buyButtons()) expect(button).toBeDisabled()

    // One attempt, one refusal.
    expect(calls.filter((c) => c.url === '/api/v1/purchases' && c.method === 'POST').length).toBe(1)
  })

  it('keeps a valid intent created before the cutoff usable', async () => {
    // §9, and the case a client-side cutoff check would break: the pass is
    // inside its cutoff window, but this intent predates it and the backend
    // still honours it for the rest of its TTL. Nothing here may cancel it or
    // refuse to pay it.
    const INTENT = aPurchase({ passId: CATALOG.id })
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    const { calls } = mockApi(
      livePurchaseRoutes(EXPIRING, INTENT, {
        txHash: TX_HASH,
        extra: { 'POST /api/v1/purchases': () => ok(INTENT, 200) },
      }),
    )

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
    await approveNativePayment(user)

    // The payment went ahead on the backend's terms, cutoff window or not.
    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1))
    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: INTENT.paymentRequest!.recipient,
      value: INTENT.paymentRequest!.valueLuna,
      data: INTENT.paymentRequest!.data,
    })

    // Nothing cancelled the intent on the way (§9).
    expect(calls.some((call) => call.url.endsWith('/cancel'))).toBe(false)
    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument()
  })

  it('does not pre-empt the backend with its own arithmetic', async () => {
    // The pass expires in 20 minutes — comfortably inside the 35-minute
    // cutoff. If the frontend computed the rule itself it would refuse here.
    // It does not: the request goes out, and the backend decides.
    const INTENT = aPurchase({ passId: CATALOG.id })
    sendBasicTransactionWithData.mockResolvedValue(TX_HASH)

    const { calls } = mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(EXPIRING),
      'POST /api/v1/purchases': () => ok(INTENT, 201),
      [`POST /api/v1/purchases/${INTENT.purchaseIntentId}/transactions`]: () =>
        ok({ ...INTENT, status: 'verifying', paymentRequest: null }, 202),
      [`/api/v1/purchases/${INTENT.purchaseIntentId}`]: () =>
        ok({ ...INTENT, status: 'verifying', paymentRequest: null }),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: CATALOG.title, level: 1 })

    // The Buy button is armed for a pass the frontend could have decided was
    // past its cutoff.
    expect(buyButtons()[0]).toBeEnabled()
    expect(screen.queryByText('Too late to buy this pass')).not.toBeInTheDocument()

    await user.click(buyButtons()[0]!)
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/v1/purchases' && c.method === 'POST')).toBe(true),
    )
  })

  it('distinguishes an unavailable pass from one inside its cutoff', async () => {
    // §39: different causes, different answers. An UNAVAILABLE pass cannot
    // be bought at all and says so before any request; a cutoff is a live
    // pass the backend declined to start a purchase for.
    const withdrawn = aPublicPass({ pass: aPass({ status: 'UNAVAILABLE' }) })

    const { calls } = mockApi({
      [`/api/v1/public/passes/${withdrawn.pass.id}`]: () => ok(withdrawn),
    })

    renderApp(`/pass/${withdrawn.pass.id}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('heading', { name: withdrawn.pass.title, level: 1 })
    expect(screen.getAllByRole('button', { name: 'Not available' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Too late to buy this pass')).not.toBeInTheDocument()
    expect(buyButtons()).toHaveLength(0)
    // No intent is attempted for a pass that is not on sale.
    expect(calls.some((c) => c.url === '/api/v1/purchases')).toBe(false)
  })
})

describe('the cutoff rule lives on the server', () => {
  it('is implemented nowhere in the frontend', () => {
    // A static check, because the runtime tests above can only prove the rule
    // is absent on the paths they walk. The cutoff is 35 minutes before
    // `expirationAt`; any client-side arithmetic on that boundary is a second
    // implementation of a money rule, and this fails the moment one appears.
    const offenders: string[] = []
    let scanned = 0

    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      if (file.includes('.test.')) continue
      scanned += 1
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

      // 35 minutes, in any of the units someone would reach for.
      if (/\b(35\s*\*\s*60|2_?100_?000|35\s*\*\s*60_?000)\b/.test(code)) {
        offenders.push(file)
      }
      // …or the rule spelled out against the pass's expiry.
      if (/cutoff/i.test(code) && /expirationAt/.test(code) && !/PASS_PURCHASE_CUTOFF/.test(code)) {
        offenders.push(file)
      }
    }

    // A scan that walked nothing would pass silently.
    expect(scanned).toBeGreaterThan(50)
    expect(offenders, `client-side cutoff arithmetic in:\n${offenders.join('\n')}`).toEqual([])
  })
})

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry)) found.push(path)
  }
  return found
}
