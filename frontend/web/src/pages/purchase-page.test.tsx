import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, livePurchaseRoutes, mockApi } from '@/test/mock-api'
import { aPurchase } from '@/test/fixtures'
import { miniAppTransportDouble } from '@/test/wallet-transport'

const sendBasicTransactionWithData = vi.fn()

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
        getNetworkReadiness: async () => ({ consensusEstablished: true, blockNumber: 100 }),
      }),
  }
})

const { renderApp, stubSession, stubWallet } = await import('@/test/render')

const OFFER = aPublicPass()
const INTENT = aPurchase()
const PURCHASE_ID = INTENT.purchaseIntentId
const WALLET = stubWallet()
const SESSION = stubSession()

beforeEach(() => {
  sendBasicTransactionWithData.mockReset()
  sendBasicTransactionWithData.mockResolvedValue('a1b2c3d4'.repeat(8))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * `/purchases/{id}` — the page Nimiq Pay's opener lands on.
 *
 * A phone reaching Nimpass through the Mini App opener arrives here, with no
 * pass page around it: this route holds the purchase and nothing else. So the
 * checkout is rendered *inline*, not as a sheet — there is nothing to scroll
 * past, and a dialog over a one-item page would be ceremony. That is the one
 * asymmetry in `PurchaseCheckout`, and this is what holds it.
 */
describe('the standalone purchase page', () => {
  it('reviews and pays inline, with no overlay in the way', async () => {
    mockApi(livePurchaseRoutes(OFFER, INTENT))

    const user = userEvent.setup()
    renderApp(`/purchases/${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    // The review is the page, with its own heading and its terms in full.
    const review = await screen.findByRole('region', { name: 'Review payment' })
    expect(screen.getByRole('heading', { name: 'Review your payment' })).toBeInTheDocument()
    expect(review).toHaveTextContent(INTENT.paymentRequest!.recipient)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(within(review).getByRole('checkbox'))
    const confirm = within(review).getByRole('button', { name: 'Confirm and pay in Nimiq Pay' })
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    await waitFor(() => expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1))
    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: INTENT.paymentRequest!.recipient,
      value: INTENT.paymentRequest!.valueLuna,
      data: INTENT.paymentRequest!.data,
    })
  })

  it('resumes the purchase by id rather than creating another one', async () => {
    const { calls } = mockApi(livePurchaseRoutes(OFFER, INTENT))

    renderApp(`/purchases/${PURCHASE_ID}`, { wallet: WALLET, session: SESSION })

    await screen.findByRole('region', { name: 'Review payment' })
    expect(
      calls.some((call) => call.method === 'POST' && call.url === '/api/v1/purchases'),
    ).toBe(false)
  })
})
