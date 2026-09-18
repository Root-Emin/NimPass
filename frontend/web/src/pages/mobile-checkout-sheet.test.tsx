import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, livePurchaseRoutes, mockApi, ok } from '@/test/mock-api'
import { aPurchase } from '@/test/fixtures'
import { miniAppTransportDouble } from '@/test/wallet-transport'

const sendBasicTransactionWithData = vi.fn()
const getNetworkReadiness = vi.fn()

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    currentTransport: () =>
      miniAppTransportDouble({
        listAccounts: async () => ['NQ07 0000 0000 0000 0000 0000 0000 0000 0081'],
        sendBasicTransactionWithData: (...args: unknown[]) =>
          sendBasicTransactionWithData(...args),
        getNetworkReadiness: () => getNetworkReadiness(),
      }),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

const OFFER = aPublicPass()
const CATALOG = OFFER.pass
const INTENT = aPurchase()
const WALLET = stubWallet()
const SESSION = stubSession()

beforeEach(() => {
  sendBasicTransactionWithData.mockReset()
  sendBasicTransactionWithData.mockResolvedValue('a1b2c3d4'.repeat(8))
  getNetworkReadiness.mockReset()
  getNetworkReadiness.mockResolvedValue({ consensusEstablished: true, blockNumber: 100 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function tapBuy(user: ReturnType<typeof userEvent.setup>) {
  renderApp(`/pass/${CATALOG.id}`, { wallet: WALLET, session: SESSION })
  await screen.findByRole('heading', { name: CATALOG.title, level: 1 })
  await user.click((await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!)
}

/**
 * Buying on a phone: the confirmation comes to the customer.
 *
 * The behaviour this replaces was the whole of the complaint. Tapping Buy used
 * to render the review into the purchase panel — which on a phone sits at the
 * bottom of a long pass page, below the artwork, the description and the facts
 * table. Nothing visibly happened at the point of the tap, and the next step
 * was somewhere the customer had to go and find. On a page that also has a
 * sticky Buy bar, the obvious reading of "nothing happened" is to tap again.
 *
 * So the assertions here are about *presence at the moment of the tap*: a
 * modal, with the four things a purchase confirmation has to state, and the one
 * action, without any scrolling in between.
 */
describe('the mobile purchase confirmation', () => {
  it('opens on the tap, with the pass, the provider, the price and the terms', async () => {
    mockApi(livePurchaseRoutes(OFFER, INTENT))

    const user = userEvent.setup()
    await tapBuy(user)

    const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })

    // What is being bought, from whom, and for how much — the summary a
    // customer needs before they approve anything.
    expect(within(sheet).getByText(CATALOG.title)).toBeInTheDocument()
    expect(within(sheet).getAllByText(OFFER.provider.name).length).toBeGreaterThan(0)
    expect(within(sheet).getAllByText(/NIM/).length).toBeGreaterThan(0)

    // The backend's own payment terms, rendered verbatim — recipient,
    // reference, network — not a recomputed copy.
    const review = within(sheet).getByRole('region', { name: 'Review payment' })
    expect(review).toHaveTextContent(INTENT.paymentRequest!.recipient)
    expect(review).toHaveTextContent(INTENT.paymentRequest!.data)
    expect(review).toHaveTextContent(INTENT.paymentRequest!.network)

    // And the way out, because nothing has been sent yet.
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('names what it is doing before the intent exists, rather than showing nothing', async () => {
    // The gap between the tap and the backend answering. It used to be a Buy
    // button reading "Working…" at the bottom of the page; now it is the
    // sheet, already open, saying which thing is being waited on.
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockApi({
      [`/api/v1/public/passes/${CATALOG.id}`]: () => ok(OFFER),
      'POST /api/v1/purchases': async () => {
        await gate
        return ok(INTENT)
      },
    })

    const user = userEvent.setup()
    await tapBuy(user)

    const preparing = await screen.findByRole('dialog', { name: 'Preparing your payment' })
    expect(within(preparing).getByRole('status')).toHaveTextContent('Preparing your payment…')

    release!()
    expect(await screen.findByRole('dialog', { name: 'Confirm your purchase' })).toBeInTheDocument()
  })

  it('confirms through the same flow, with the same official provider call', async () => {
    mockApi(livePurchaseRoutes(OFFER, INTENT))

    const user = userEvent.setup()
    await tapBuy(user)

    const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })
    await user.click(within(sheet).getByRole('checkbox'))
    const confirm = within(sheet).getByRole('button', { name: 'Confirm and pay in Nimiq Pay' })
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    // Nothing about the surface changed the payment: exactly the backend's
    // recipient, Luna value and NP1 reference reach the provider API.
    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1))
    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: INTENT.paymentRequest!.recipient,
      value: INTENT.paymentRequest!.valueLuna,
      data: INTENT.paymentRequest!.data,
    })
  })

  it('follows the payment in the same place, naming each stage', async () => {
    mockApi(livePurchaseRoutes(OFFER, INTENT))

    const user = userEvent.setup()
    await tapBuy(user)

    const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })
    await user.click(within(sheet).getByRole('checkbox'))
    await user.click(within(sheet).getByRole('button', { name: 'Confirm and pay in Nimiq Pay' }))

    // The customer stays where they were, and the sheet reports rather than
    // reverting to a spinner with no words on it.
    expect(
      await screen.findByRole('dialog', { name: 'Confirming your payment' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument()

    // Once something may have been sent, there is no "never mind" on offer.
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('closes so the page can explain an outcome that needs more than a line', async () => {
    mockApi(
      livePurchaseRoutes(OFFER, INTENT, {
        afterBroadcast: () => ({
          ...INTENT,
          status: 'permanently_failed',
          paymentRequest: null,
          paymentVerification: 'MISMATCH',
        }),
      }),
    )

    const user = userEvent.setup()
    await tapBuy(user)

    const sheet = await screen.findByRole('dialog', { name: 'Confirm your purchase' })
    await user.click(within(sheet).getByRole('checkbox'))
    await user.click(within(sheet).getByRole('button', { name: 'Confirm and pay in Nimiq Pay' }))

    // A refused payment is a paragraph, not a status line, and it belongs on
    // the page where it can be read at leisure — so the sheet gets out of the
    // way rather than stacking a modal over the explanation.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      await screen.findByText(/didn't match this purchase/i),
    ).toBeInTheDocument()
  })
})
