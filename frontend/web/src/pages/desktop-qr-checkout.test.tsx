import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, domainError, mockApi, ok } from '@/test/mock-api'
import { aPurchase } from '@/test/fixtures'
import { nimToLuna } from '@/lib/format'
import { parsePaymentUri } from '@/lib/nimiq/payment-uri'
import { hubTransportDouble } from '@/test/wallet-transport'

/**
 * The desktop checkout: Buy Pass creates the Purchase Intent, and the phone
 * pays *that intent* after scanning a QR.
 *
 * Two properties are load-bearing throughout, and most of these tests exist to
 * pin one of them down:
 *
 *  1. **The desktop never initiates a transaction.** No Hub checkout, no
 *     `sendBasicTransactionWithData()`. The browser's only job is to create the
 *     intent, render its locator, and watch the backend.
 *  2. **The desktop learns the outcome by itself.** It polls
 *     `GET /purchases/{id}` — the endpoint that already exists — and every
 *     stage the modal reports is a status the backend actually sent.
 *
 * The wallet is stubbed at the transport boundary, so a call to it would be
 * visible here. It never comes.
 */

const checkout = vi.fn()
const windowOpened = vi.fn()

/**
 * The QR encoder, captured.
 *
 * The payload is the one thing about this screen that a customer's wallet
 * actually acts on, so it is asserted at the point it is handed to the encoder
 * rather than inferred from the DTO that fed it.
 */
const toDataURL = vi.fn(async (_payload: string) => 'data:image/png;base64,QR')
vi.mock('qrcode', () => ({
  default: { toDataURL: (payload: string, ..._rest: unknown[]) => toDataURL(payload) },
}))

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    currentTransport: () =>
      hubTransportDouble({
        checkout: (...args: [Parameters<typeof checkout>[0]]) => checkout(...args),
        windowOpened: (...args: [string]) => windowOpened(...args),
      }),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

const OFFER = aPublicPass()
const CATALOG = OFFER.pass
const INTENT = aPurchase()
const PURCHASE_ID = INTENT.purchaseIntentId
const TX_HASH = 'a1b2c3d4'.repeat(8)
const PASS_ID = '40000000-0000-4000-8000-000000000001'

/**
 * An ordinary desktop browser: no injected provider, and jsdom's user-agent
 * names no handheld — so `classifyCheckoutDevice` answers `desktop`, which is
 * what puts this whole file on the QR branch.
 */
const DESKTOP = stubWallet({
  capabilities: {
    nimiqProviderAvailable: true,
    walletOperationsAvailable: true,
    insideNimiqPay: false,
    transport: 'hub',
    gesturePerOperation: true,
  },
})
const SESSION = stubSession()

beforeEach(() => {
  checkout.mockReset()
  windowOpened.mockReset()
  toDataURL.mockClear()
  // A publicly reachable origin, so the locator is the official HTTPS Mini App
  // opener rather than the LAN fallback. jsdom serves from localhost.
  vi.stubEnv('VITE_PUBLIC_ORIGIN', 'https://nimpass.example')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The QR modal, once it is up. */
async function paymentModal(): Promise<HTMLElement> {
  return screen.findByRole('dialog')
}

/**
 * The string actually encoded into the QR image.
 *
 * Read back through the `qrcode` mock rather than from the DTO, so these tests
 * assert what a camera would see and not what we hoped was passed along.
 */
async function qrPayload(): Promise<string> {
  const modal = await paymentModal()
  await within(modal).findByAltText('Nimiq payment request for this purchase')
  expect(toDataURL).toHaveBeenCalled()
  return toDataURL.mock.calls.at(-1)![0]
}

async function pressBuy(user: ReturnType<typeof userEvent.setup>, path = `/pass/${CATALOG.id}`) {
  const rendered = renderApp(path, { wallet: DESKTOP, session: SESSION })
  await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
  await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!)
  return rendered
}

describe('the desktop QR modal', () => {
  it('opens on the intent the backend just created, and offers it to a phone', async () => {
    const { calls } = mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    await pressBuy(user)

    const modal = await paymentModal()
    expect(within(modal).getByText('Complete your payment')).toBeInTheDocument()
    expect(within(modal).getByText(CATALOG.title)).toBeInTheDocument()

    // The exact amount the backend snapshotted into this intent, not the
    // catalog's displayed price.
    expect(within(modal).getByText('250 NIM')).toBeInTheDocument()

    // The QR itself, rendered from the backend's payment request.
    expect(
      await within(modal).findByAltText('Nimiq payment request for this purchase'),
    ).toBeInTheDocument()

    // The intent was created exactly once, before any of this.
    expect(calls.filter((c) => c.url === '/api/v1/purchases' && c.method === 'POST')).toHaveLength(1)
  })

  it('encodes the backend’s payment request, with the provider wallet and the exact price', async () => {
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    await pressBuy(user)
    await paymentModal()

    // What actually reaches the customer's wallet. The payload is the
    // backend's `paymentRequest.uri`, and the modal renders it only after
    // `verifiedPaymentUri` agrees it names the same recipient and amount the
    // DTO states separately (ADR-006).
    const request = INTENT.paymentRequest!
    const encoded = await qrPayload()

    const parsed = parsePaymentUri(encoded)
    expect(parsed).not.toBeNull()
    // Recipient: the provider wallet from the intent's snapshot, never typed.
    expect(parsed!.recipient).toBe(request.recipient.replaceAll(' ', ''))
    // Amount: the Pass price as decimal NIM, which is what the official
    // request-link encoding carries — 250, not 25,000,000 Luna.
    expect(parsed!.amountNim).toBe('250')
    expect(nimToLuna(parsed!.amountNim)).toBe(request.valueLuna)
    // And the purchase reference, so the chain can name this exact intent.
    expect(parsed!.reference).toBe(request.data)
  })

  it('produces a different amount for a different Pass, always the server’s', async () => {
    // The amount is the intent's snapshot, so a second Pass at another price
    // yields another QR — and nothing on the page can shift either of them.
    const dearer = aPurchase({
      purchaseIntentId: PURCHASE_ID,
      paymentRequest: { ...INTENT.paymentRequest!, valueLuna: 100_000_000, valueNim: '1000',
        uri: INTENT.paymentRequest!.uri!.replace('amount=250', 'amount=1000') },
    })
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(dearer),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(dearer),
    })

    const user = userEvent.setup()
    await pressBuy(user)
    await paymentModal()

    const parsed = parsePaymentUri(await qrPayload())
    expect(parsed!.amountNim).toBe('1000')
    expect(nimToLuna(parsed!.amountNim)).toBe(100_000_000)
  })

  it('refuses to show a code whose terms disagree with the purchase', async () => {
    // A payment instruction that does not match the price printed beside it is
    // not something to render and hope about. The opener still reaches the same
    // intent, so the customer is not stranded.
    const tampered = aPurchase({
      purchaseIntentId: PURCHASE_ID,
      paymentRequest: {
        ...INTENT.paymentRequest!,
        uri: INTENT.paymentRequest!.uri!.replace('amount=250', 'amount=1'),
      },
    })
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(tampered),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(tampered),
    })

    const user = userEvent.setup()
    await pressBuy(user)
    const modal = await paymentModal()

    await waitFor(() =>
      expect(
        within(modal).queryByAltText('Nimiq payment request for this purchase'),
      ).not.toBeInTheDocument(),
    )
    expect(within(modal).getByRole('link', { name: /Open in Nimiq Pay/i })).toBeInTheDocument()
  })

  it('names the wallet the Pass will belong to, before anything is scanned', async () => {
    // The desktop flow pays from a *different physical device*, so the
    // customer reasonably wonders where the Pass ends up.
    //
    // This used to be a warning — pay from this wallet or the payment cannot
    // create the Pass — and it was true, because the verifier required the
    // on-chain sender to be the wallet the intent was issued for. That rule
    // is what made a payment approved from a second Nimiq Pay account
    // unmatchable, and it is gone for a payment carrying this purchase's own
    // reference. So the line states ownership instead of threatening it: the
    // Pass goes to the signed-in wallet whoever pays.
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    await pressBuy(user)
    const modal = await paymentModal()
    await user.click(within(modal).getByText('Payment details'))

    expect(within(modal).getByText(INTENT.customerWallet)).toBeInTheDocument()
    expect(within(modal).getByText(/The Pass goes to the wallet shown above/i)).toBeInTheDocument()
    // And it must not read as an instruction the customer can fail.
    expect(
      within(modal).queryByText(/cannot create this Pass/i),
    ).not.toBeInTheDocument()
  })

  it('tells the customer the desktop will notice the payment by itself', async () => {
    // The acceptance criterion of this whole flow, said on screen: nothing is
    // copied back from the phone, and no refresh is required.
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    await pressBuy(user)
    const modal = await paymentModal()

    expect(
      within(modal).getByText(/updates by itself once the payment is on the blockchain/i),
    ).toBeInTheDocument()
    // No transaction-hash field anywhere near an ordinary purchase.
    expect(screen.queryByLabelText('Transaction hash')).not.toBeInTheDocument()
    expect(screen.queryByText(/Paid, but still waiting/)).not.toBeInTheDocument()
  })

  it('names the scanner that reads the code, and offers a way out if it refuses', async () => {
    // The code is a payment request now, so the scanner is Nimiq Pay's own
    // Pay -> Scan. Whether it accepts this exact payload is unverified on a
    // device (ADR-006 G1), which is why the opener has to be right there.
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    await pressBuy(user)
    const modal = await paymentModal()

    expect(within(modal).getByText(/Scan with Nimiq Pay/i)).toBeInTheDocument()
    expect(
      within(modal).getByRole('link', { name: /Open this purchase in Nimiq Pay/i }),
    ).toBeInTheDocument()
  })

  it('starts in the pending state and never claims a payment that has not happened', async () => {
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    await pressBuy(user)
    const modal = await paymentModal()

    expect(within(modal).getByText('Waiting for payment…')).toBeInTheDocument()
    expect(screen.queryByText(/Payment successful/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /View Pass/i })).not.toBeInTheDocument()
  })

  it('initiates no transaction from the desktop at all', async () => {
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    await pressBuy(user)
    await paymentModal()

    // Not through the Hub, and not through the provider. The phone pays.
    expect(checkout).not.toHaveBeenCalled()
    expect(windowOpened).not.toHaveBeenCalled()
  })
})

describe('the desktop follows the phone’s payment on its own', () => {
  it('walks detection, verification and finality through to the Pass', async () => {
    // Nobody touches this browser again after Buy. Every line below is a status
    // the backend reported and the desktop picked up by polling.
    //
    // This is the mission's acceptance scenario in one test: the phone pays,
    // the backend finds the transaction on chain by itself, and this window
    // arrives at the Pass without the customer copying a hash, opening an
    // explorer, or refreshing. `noHashWasEverReported` below is the
    // assertion that actually pins that down.
    const statuses = [
      'awaiting_payment',
      'transaction_submitted',
      'verifying',
      'awaiting_finality',
      'completed',
    ] as const
    let poll = 0

    const { calls } = mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => {
        const status = statuses[Math.min(poll++, statuses.length - 1)]!
        if (status === 'awaiting_payment') return ok(INTENT)
        return ok({
          ...INTENT,
          status,
          paymentRequest: null,
          transactionHash: TX_HASH,
          purchasedPassId: status === 'completed' ? PASS_ID : null,
        })
      },
    })

    const user = userEvent.setup()
    await pressBuy(user)
    const modal = await paymentModal()
    expect(within(modal).getByText('Waiting for payment…')).toBeInTheDocument()

    expect(await screen.findByText('Payment detected', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(await screen.findByText('Verifying payment…', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(await screen.findByText('Confirming payment…', {}, { timeout: 8000 })).toBeInTheDocument()

    // Success arrives in the same window the customer has been watching.
    expect(await screen.findByText('Payment confirmed', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByText('Your Pass is ready.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Pass' })).toHaveAttribute(
      'href',
      `/passes/${PASS_ID}`,
    )

    // Still nothing was signed or sent from this machine.
    expect(checkout).not.toHaveBeenCalled()

    // And — the point of the whole flow — no transaction hash was ever
    // reported from here. The desktop never had one to report: the backend
    // found the payment on chain. A customer completing this purchase never
    // meets a transaction hash at all.
    expect(calls.some((call) => call.url.endsWith('/transactions'))).toBe(false)
    expect(screen.queryByLabelText('Transaction hash')).not.toBeInTheDocument()
    expect(screen.queryByText(/Paid, but still waiting/)).not.toBeInTheDocument()
  }, 30_000)

  it('takes the QR away the moment a payment is detected', async () => {
    // A scannable code beside "Verifying payment" is an invitation to pay twice.
    let paid = false
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => {
        const body = paid
          ? { ...INTENT, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }
          : INTENT
        paid = true
        return ok(body)
      },
    })

    const user = userEvent.setup()
    await pressBuy(user)
    const modal = await paymentModal()
    await within(modal).findByAltText('Nimiq payment request for this purchase')

    await screen.findByText('Verifying payment…', {}, { timeout: 8000 })
    expect(screen.queryByAltText('Nimiq payment request for this purchase')).not.toBeInTheDocument()
  }, 20_000)

  it('stops polling once the modal and its page are gone', async () => {
    // No uncontrolled timers: the flow clears its poll on unmount, so a closed
    // tab does not keep asking the backend about a purchase nobody is watching.
    const { calls } = mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    const rendered = await pressBuy(user)
    await paymentModal()

    rendered.unmount()
    const afterUnmount = calls.length
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    expect(calls.length).toBe(afterUnmount)
  }, 20_000)
})

describe('when the payment cannot happen', () => {
  it('shows an expired request instead of a code nobody can pay', async () => {
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'expired', paymentRequest: null }),
    })

    renderApp(`/pass/${CATALOG.id}?purchase=${PURCHASE_ID}`, { wallet: DESKTOP, session: SESSION })

    expect(await screen.findByText('This payment request expired')).toBeInTheDocument()
    expect(screen.queryByAltText('Nimiq payment request for this purchase')).not.toBeInTheDocument()
    expect(checkout).not.toHaveBeenCalled()
  })

  it('never opens a wallet when the backend refuses the intent', async () => {
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () =>
        domainError(409, 'PASS_PURCHASE_CUTOFF', 'Too close to expiry'),
    })

    const user = userEvent.setup()
    await pressBuy(user)

    expect(await screen.findByText('Too late to buy this pass')).toBeInTheDocument()
    expect(screen.getByText('You have not been charged.')).toBeInTheDocument()
    expect(checkout).not.toHaveBeenCalled()
  })

  it('reports a network failure before the intent as a definite non-payment', async () => {
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
    })

    const user = userEvent.setup()
    await pressBuy(user)

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.getByText(/couldn't reach Nimpass/i)).toBeInTheDocument()
    expect(checkout).not.toHaveBeenCalled()
  })
})

describe('closing and coming back', () => {
  it('lets the customer put the code away without abandoning the purchase', async () => {
    const { calls } = mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': () => ok(INTENT),
      [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
    })

    const user = userEvent.setup()
    await pressBuy(user)
    const modal = await paymentModal()

    await user.click(within(modal).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Closed, not cancelled: nothing was told to the backend, and the code
    // comes straight back.
    expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(false)
    await user.click(screen.getByRole('button', { name: /Show payment code/i }))
    expect(await paymentModal()).toBeInTheDocument()
  })

  it('reopens the same intent after a refresh rather than asking for a second payment', async () => {
    // The customer scans, pays on the phone, and reloads the desktop tab while
    // the transaction is still settling (docs/05 §66, §138).
    const { calls } = mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'verifying', paymentRequest: null, transactionHash: TX_HASH }),
    })

    renderApp(`/pass/${CATALOG.id}?purchase=${PURCHASE_ID}`, { wallet: DESKTOP, session: SESSION })

    expect(await screen.findByText('Verifying payment…')).toBeInTheDocument()
    // No new intent, no second code, no way to start another payment.
    expect(calls.some((c) => c.url === '/api/v1/purchases' && c.method === 'POST')).toBe(false)
    expect(screen.queryByAltText('Nimiq payment request for this purchase')).not.toBeInTheDocument()
    for (const button of screen.queryAllByRole('button', { name: /Buy with NIM/i })) {
      expect(button).toBeDisabled()
    }
  })

  it('refuses to be dismissed once a transaction may exist', async () => {
    // Past a possible broadcast the modal is reporting on money. "Not now" would
    // read as "never mind", which is not on offer (docs/05 §55).
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      [`/api/v1/purchases/${PURCHASE_ID}`]: () =>
        ok({ ...INTENT, status: 'awaiting_finality', paymentRequest: null, transactionHash: TX_HASH }),
    })

    const user = userEvent.setup()
    renderApp(`/pass/${CATALOG.id}?purchase=${PURCHASE_ID}`, { wallet: DESKTOP, session: SESSION })

    const modal = await paymentModal()
    await screen.findByText('Confirming payment…')

    expect(within(modal).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(
      within(modal).queryByRole('button', { name: /Cancel this payment/i }),
    ).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // The one safe control: re-read the evidence. It can never pay.
    expect(within(modal).getByRole('button', { name: 'Check again' })).toBeInTheDocument()
  })
})
