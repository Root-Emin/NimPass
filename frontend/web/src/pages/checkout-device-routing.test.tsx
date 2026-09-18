import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, mockApi, ok } from '@/test/mock-api'
import { aPurchase } from '@/test/fixtures'
import { hubTransportDouble, miniAppTransportDouble } from '@/test/wallet-transport'

/**
 * Device routing, end to end: which checkout Buy Pass actually produces.
 *
 * The rule under test is the one this milestone is about — **the device class
 * chooses the payment experience, and the Purchase Intent is created first
 * either way**. So every case here presses the same button against the same
 * backend and asserts only on what appears afterwards:
 *
 *   mobile  →  a confirmation sheet ending in `sendBasicTransactionWithData()`
 *   desktop →  a QR modal, and no transaction from this machine
 *
 * The mobile branch is an overlay rather than a panel further down the page:
 * tapping Buy opens the confirmation immediately instead of rendering it below
 * the fold for the customer to go and find. The two surfaces are therefore both
 * dialogs, and the assertions below distinguish them by name and by content —
 * the QR image is the thing a phone must never be handed.
 *
 * The classification rules themselves are unit-tested in
 * `src/lib/checkout-device.test.ts`. This file proves they are wired to the
 * thing they are supposed to decide.
 */

const sendBasicTransactionWithData = vi.fn()
const checkout = vi.fn()

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    currentTransport: () =>
      transportKind === 'mini-app'
        ? miniAppTransportDouble({
            listAccounts: async () => ['NQ07 0000 0000 0000 0000 0000 0000 0000 0081'],
            sendBasicTransactionWithData: (...args: unknown[]) =>
              sendBasicTransactionWithData(...args),
            getNetworkReadiness: async () => ({ consensusEstablished: true, blockNumber: 100 }),
          })
        : hubTransportDouble({ checkout: (...args: [unknown]) => checkout(...args) }),
  }
})

/** Read by the mock above; set by each case before rendering. */
let transportKind: 'mini-app' | 'hub' = 'hub'

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

const OFFER = aPublicPass()
const CATALOG = OFFER.pass
const INTENT = aPurchase()
const PURCHASE_ID = INTENT.purchaseIntentId
const SESSION = stubSession()

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipad:
    'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  mac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
}

/**
 * Presents jsdom as a particular machine for the duration of one test.
 *
 * `defineProperty` rather than `vi.spyOn`, because jsdom's Navigator declares
 * `userAgent` on the prototype and does not declare `maxTouchPoints` at all —
 * which is itself worth noting: the classifier reads it as `?? 0`, so a browser
 * without it is simply a browser with no touch.
 */
const restoreDevice: (() => void)[] = []

function pretendDevice({ userAgent, touchPoints = 0 }: { userAgent: string; touchPoints?: number }) {
  for (const [key, value] of [
    ['userAgent', userAgent],
    ['maxTouchPoints', touchPoints],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(navigator, key)
    Object.defineProperty(navigator, key, { value, configurable: true })
    restoreDevice.push(() => {
      if (original) Object.defineProperty(navigator, key, original)
      else Reflect.deleteProperty(navigator, key)
    })
  }
}

function routes() {
  return mockApi({
    [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
    'POST /api/v1/purchases': () => ok(INTENT),
    [`POST /api/v1/purchases/${PURCHASE_ID}/wallet-attempts`]: () => ok(INTENT, 201),
    [`GET /api/v1/purchases/${PURCHASE_ID}`]: () => ok(INTENT),
  })
}

async function buy(user: ReturnType<typeof userEvent.setup>, wallet: ReturnType<typeof stubWallet>) {
  const rendered = renderApp(`/pass/${CATALOG.id}`, { wallet, session: SESSION })
  await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
  await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!)
  return rendered
}

/** Inside Nimiq Pay: the injected provider is there to be called. */
const IN_NIMIQ_PAY = stubWallet()

/** An ordinary browser, on whatever machine the test is pretending to be. */
const ORDINARY_BROWSER = stubWallet({
  capabilities: {
    nimiqProviderAvailable: true,
    walletOperationsAvailable: true,
    insideNimiqPay: false,
    transport: 'hub',
    gesturePerOperation: true,
  },
})

beforeEach(() => {
  sendBasicTransactionWithData.mockReset()
  sendBasicTransactionWithData.mockResolvedValue('a1b2c3d4'.repeat(8))
  checkout.mockReset()
  transportKind = 'hub'
})

afterEach(() => {
  vi.unstubAllGlobals()
  while (restoreDevice.length) restoreDevice.pop()!()
})

describe('mobile checkout', () => {
  it('routes a phone inside Nimiq Pay to the native transaction', async () => {
    transportKind = 'mini-app'
    pretendDevice({ userAgent: UA.iphone, touchPoints: 5 })
    routes()

    const user = userEvent.setup()
    await buy(user, IN_NIMIQ_PAY)

    // The native review, in the sheet that opened on the tap — not a QR.
    const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })
    expect(within(sheet).getByRole('region', { name: 'Review payment' })).toBeInTheDocument()
    expect(screen.queryByAltText('Nimiq payment request for this purchase')).not.toBeInTheDocument()

    await user.click(within(sheet).getByRole('checkbox'))
    const approve = within(sheet).getByRole('button', { name: 'Confirm and pay in Nimiq Pay' })
    await waitFor(() => expect(approve).toBeEnabled())
    await user.click(approve)

    // Exactly the official provider call, with exactly the backend's terms.
    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1))
    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: INTENT.paymentRequest!.recipient,
      value: INTENT.paymentRequest!.valueLuna,
      data: INTENT.paymentRequest!.data,
    })
  }, 20_000)

  it('routes a tablet to the mobile checkout, not to a QR it would scan with itself', async () => {
    // Policy: Nimiq Pay ships for tablets, so a tablet pays natively.
    transportKind = 'mini-app'
    pretendDevice({ userAgent: UA.ipad, touchPoints: 5 })
    routes()

    const user = userEvent.setup()
    await buy(user, IN_NIMIQ_PAY)

    const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })
    expect(within(sheet).getByRole('region', { name: 'Review payment' })).toBeInTheDocument()
    expect(screen.queryByAltText('Nimiq payment request for this purchase')).not.toBeInTheDocument()
  })

  it('hands an iPad in desktop mode the mobile checkout, by its touch points alone', async () => {
    // The user-agent is byte-identical to a Mac's. Without the touch rule this
    // iPad would be shown a QR code and asked to scan it with itself.
    transportKind = 'mini-app'
    pretendDevice({ userAgent: UA.mac, touchPoints: 5 })
    routes()

    const user = userEvent.setup()
    await buy(user, IN_NIMIQ_PAY)

    const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })
    expect(within(sheet).getByRole('region', { name: 'Review payment' })).toBeInTheDocument()
    expect(screen.queryByAltText('Nimiq payment request for this purchase')).not.toBeInTheDocument()
  })

  it('offers a phone browser the tap-through opener instead of a QR', async () => {
    // A phone outside Nimiq Pay has no provider to call. It still gets the
    // mobile shape of the handoff — one tap on the device already in hand.
    pretendDevice({ userAgent: UA.iphone, touchPoints: 5 })
    routes()

    const user = userEvent.setup()
    await buy(user, ORDINARY_BROWSER)

    const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })
    expect(within(sheet).getByRole('region', { name: 'Continue in Nimiq Pay' })).toBeInTheDocument()
    // The documented custom-scheme opener, carrying this purchase's own route
    // percent-encoded in its `url` parameter and nothing besides.
    const open = within(sheet).getByRole('link', { name: /Open in Nimiq Pay/i })
    const opener = new URL(open.getAttribute('href')!)
    expect(opener.protocol).toBe('nimiqpay:')
    expect([...opener.searchParams.keys()]).toEqual(['url'])
    expect(opener.searchParams.get('url')).toContain(`/purchases/${PURCHASE_ID}`)
    // No QR: the device that would scan it is the device showing it.
    expect(screen.queryByAltText('Nimiq payment request for this purchase')).not.toBeInTheDocument()
    expect(checkout).not.toHaveBeenCalled()
  })

  it('never shows the native checkout without a provider, however phone-shaped the screen', async () => {
    // The rule that makes this capability-first rather than viewport-first
    // (docs mission §12). Every one of these devices classifies as `mobile`,
    // and not one of them has a provider to call — so "Approve in Nimiq Pay"
    // would be a button with nothing behind it.
    for (const device of [
      { userAgent: UA.iphone, touchPoints: 5 },
      { userAgent: UA.ipad, touchPoints: 5 },
      { userAgent: UA.mac, touchPoints: 5 },
    ]) {
      transportKind = 'hub'
      pretendDevice(device)
      routes()

      const user = userEvent.setup()
      const { unmount } = await buy(user, ORDINARY_BROWSER)

      const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })
      expect(within(sheet).getByRole('region', { name: 'Continue in Nimiq Pay' })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Confirm and pay in Nimiq Pay' }),
      ).not.toBeInTheDocument()
      expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
      unmount()
    }
  }, 30_000)
})

describe('desktop checkout', () => {
  it('routes a desktop browser to the QR modal and initiates nothing locally', async () => {
    pretendDevice({ userAgent: UA.mac, touchPoints: 0 })
    routes()

    const user = userEvent.setup()
    await buy(user, ORDINARY_BROWSER)

    const modal = await screen.findByRole('dialog')
    expect(modal).toHaveTextContent('Complete your payment')
    expect(await screen.findByAltText('Nimiq payment request for this purchase')).toBeInTheDocument()

    // No native review, and nothing signed or sent here.
    expect(screen.queryByRole('button', { name: 'Approve in Nimiq Pay' })).not.toBeInTheDocument()
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
    expect(checkout).not.toHaveBeenCalled()
  })

  it('creates the Purchase Intent before it decides anything about the device', async () => {
    // The order the whole design depends on: one intent, then the branch. Both
    // branches then pay that same intent.
    pretendDevice({ userAgent: UA.mac, touchPoints: 0 })
    const { calls } = routes()

    const user = userEvent.setup()
    await buy(user, ORDINARY_BROWSER)

    await screen.findByRole('dialog')
    const intentCalls = calls.filter((c) => c.url === '/api/v1/purchases' && c.method === 'POST')
    expect(intentCalls).toHaveLength(1)
    // Only the pass travels. Price, recipient and reference come back from the
    // backend and are never proposed by the client.
    expect(intentCalls[0]!.body).toEqual({ passId: CATALOG.id })
  })

  it('does not create a second intent for the same checkout when Buy is pressed twice', async () => {
    pretendDevice({ userAgent: UA.mac, touchPoints: 0 })
    const { calls } = routes()

    const user = userEvent.setup()
    await buy(user, ORDINARY_BROWSER)
    await screen.findByRole('dialog')

    // The panel's Buy button is replaced by the checkout once an intent exists,
    // so a second press has to come from the sticky bar if it comes at all.
    for (const button of screen.queryAllByRole('button', { name: /Buy with NIM/i })) {
      if (!button.hasAttribute('disabled')) await user.click(button)
    }

    expect(calls.filter((c) => c.url === '/api/v1/purchases' && c.method === 'POST')).toHaveLength(1)
  })
})
