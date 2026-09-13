import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api'
import { aPurchase } from '@/test/fixtures'

const createPurchaseIntent = vi.fn()
const getPurchase = vi.fn()
const reconcilePurchase = vi.fn()
const submitTransaction = vi.fn()
const sendBasicTransactionWithData = vi.fn()
const getNetworkReadiness = vi.fn()

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    purchasesApi: {
      createPurchaseIntent: (...args: unknown[]) => createPurchaseIntent(...args),
      getPurchase: (...args: unknown[]) => getPurchase(...args),
      reconcilePurchase: (...args: unknown[]) => reconcilePurchase(...args),
      submitTransaction: (...args: unknown[]) => submitTransaction(...args),
    },
  }
})

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    NIMIQ_NETWORK: 'TESTNET',
    sendBasicTransactionWithData: (...args: unknown[]) => sendBasicTransactionWithData(...args),
    getNetworkReadiness: (...args: unknown[]) => getNetworkReadiness(...args),
  }
})

const { SessionContext } = await import('@/app/session-context')
const { stubSession } = await import('@/test/render')
const { usePurchaseFlow } = await import('./use-purchase-flow')

const sessionContext = {
  session: stubSession(),
  isRecovering: false,
  flow: { kind: 'IDLE' } as const,
  signIn: async () => null,
  signOut: async () => {},
  resetFlow: () => {},
}
const { NimiqOperationError, nimiqError } = await import('@/lib/nimiq')

const intent = aPurchase()

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={sessionContext}>{children}</SessionContext.Provider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  createPurchaseIntent.mockReset()
  getPurchase.mockReset()
  reconcilePurchase.mockReset()
  submitTransaction.mockReset()
  sendBasicTransactionWithData.mockReset()
  getNetworkReadiness.mockReset()
  // Read-only pre-flight: consensus available unless a test says otherwise.
  getNetworkReadiness.mockResolvedValue({ consensusEstablished: true, blockNumber: 1_000 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePurchaseFlow', () => {
  it('sends exactly the amount, recipient and reference the backend issued', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockResolvedValue('0xhash')
    submitTransaction.mockResolvedValue({ ...intent, status: 'verifying', paymentRequest: null })
    getPurchase.mockResolvedValue({
      ...intent,
      status: 'completed',
      paymentRequest: null,
      passId: 'pass_1',
      transactionHash: '0xhash',
    })

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    // Exactly the server-authored payment request, unmodified.
    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: intent.paymentRequest!.recipient,
      value: intent.paymentRequest!.valueLuna,
      data: intent.paymentRequest!.data,
    })
    await waitFor(() => expect(result.current.state.kind).toBe('COMPLETE'))
  })

  it('treats a wallet rejection as a cancellation, not a failure', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockRejectedValue(
      new NimiqOperationError(nimiqError('USER_REJECTED')),
    )

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    expect(result.current.state.kind).toBe('CANCELLED')
    expect(submitTransaction).not.toHaveBeenCalled()
  })

  it('maps insufficient funds to a definite failure', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockRejectedValue(
      new NimiqOperationError(nimiqError('INSUFFICIENT_FUNDS')),
    )

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    expect(result.current.state).toEqual(
      expect.objectContaining({ kind: 'FAILED', reason: 'INSUFFICIENT_FUNDS' }),
    )
  })

  it('goes UNCERTAIN — never FAILED — when the wallet result cannot be classified', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockRejectedValue(new Error('window closed mid-flight'))

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    expect(result.current.state.kind).toBe('UNCERTAIN')
  })

  it('goes UNCERTAIN when the backend is unreachable after the transaction was submitted', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockResolvedValue('0xhash')
    submitTransaction.mockRejectedValue(
      new ApiError({ code: 'NETWORK_ERROR', message: 'offline' }),
    )
    reconcilePurchase.mockRejectedValue(
      new ApiError({ code: 'NETWORK_ERROR', message: 'offline' }),
    )
    getPurchase.mockRejectedValue(new ApiError({ code: 'NETWORK_ERROR', message: 'offline' }))

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    expect(result.current.state.kind).toBe('UNCERTAIN')
  })

  it('refuses to pay an intent issued for a different network', async () => {
    createPurchaseIntent.mockResolvedValue({
      ...intent,
      paymentRequest: { ...intent.paymentRequest!, network: 'MAINNET' },
    })

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    expect(result.current.state.kind).toBe('FAILED')
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('carries an idempotency key on intent creation, where the contract wants one', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockResolvedValue('0xhash')
    submitTransaction.mockResolvedValue({ ...intent, status: 'verifying', paymentRequest: null })
    getPurchase.mockResolvedValue({
      ...intent,
      status: 'completed',
      paymentRequest: null,
      passId: 'pass_1',
    })

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    // `POST /purchases` is the one operation `backend/openapi.yaml` gives an
    // `Idempotency-Key` parameter, so a double click cannot mint two intents
    // (docs/05 §68).
    expect(createPurchaseIntent.mock.calls[0]?.[1]?.idempotencyKey).toBeTruthy()

    // Submission needs no key: the contract makes it idempotent for the same
    // hash and a *different* candidate a 409, which is stronger than a header.
    expect(submitTransaction.mock.calls[0]?.[2]?.idempotencyKey).toBeUndefined()
  })

  it('never produces a pass id the backend did not return', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockResolvedValue('0xhash')
    submitTransaction.mockResolvedValue({ ...intent, status: 'pass_provisioning', paymentRequest: null, passId: null })
    getPurchase.mockResolvedValue({ ...intent, status: 'pass_provisioning', paymentRequest: null, passId: null })

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    // Payment settled, pass not provisioned yet: the UI waits rather than
    // inventing a pass (docs/05 §54).
    expect(result.current.state.kind).toBe('PASS_CREATING')
  })
})
