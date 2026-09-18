import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api'
import { mayRetryPayment } from '@/types/payment'
import { aPurchase, aSettlement } from '@/test/fixtures'

const createPurchaseIntent = vi.fn()
const getPurchase = vi.fn()
const reconcilePurchase = vi.fn()
const submitTransaction = vi.fn()
const beginWalletAttempt = vi.fn()
const releaseWalletAttempt = vi.fn()
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
      beginWalletAttempt: (...args: unknown[]) => beginWalletAttempt(...args),
      releaseWalletAttempt: (...args: unknown[]) => releaseWalletAttempt(...args),
    },
  }
})

vi.mock('@/api/runtime', () => ({ requireBackendNetwork: async () => {} }))

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
        sendBasicTransactionWithData: (...args: unknown[]) =>
          sendBasicTransactionWithData(...args),
        getNetworkReadiness: (...args: unknown[]) => getNetworkReadiness(...args),
      }),
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
  beginWalletAttempt.mockReset()
  releaseWalletAttempt.mockReset()
  sendBasicTransactionWithData.mockReset()
  getNetworkReadiness.mockReset()
  getNetworkReadiness.mockResolvedValue({ consensusEstablished: true, blockNumber: 1_000 })
  beginWalletAttempt.mockResolvedValue(intent)
  getPurchase.mockResolvedValue(intent)
  releaseWalletAttempt.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePurchaseFlow', () => {
  async function startThenPay(result: { current: ReturnType<typeof usePurchaseFlow> }) {
    await act(async () => {
      await result.current.start()
    })
    await act(async () => {
      await result.current.pay()
    })
  }

  it('sends exactly the amount, recipient and reference the backend issued', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockResolvedValue('0xhash')
    submitTransaction.mockResolvedValue({ ...intent, status: 'verifying', paymentRequest: null })
    let paid = false
    getPurchase.mockImplementation(async () =>
      paid
        ? {
            ...intent,
            status: 'completed',
            paymentRequest: null,
            purchasedPassId: 'pass_1',
            transactionHash: '0xhash',
          }
        : intent,
    )
    submitTransaction.mockImplementation(async () => {
      paid = true
      return { ...intent, status: 'verifying', paymentRequest: null }
    })

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await startThenPay(result)

    // Exactly the server-authored payment request, unmodified.
    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: intent.paymentRequest!.recipient,
      value: intent.paymentRequest!.valueLuna,
      data: intent.paymentRequest!.data,
    })
    await waitFor(() => expect(result.current.state.kind).toBe('COMPLETE'))
  })

  it('reaches success on the first settling poll, without a finality stage', async () => {
    // What the latency work bought (ADR-021). The backend settles on canonical
    // inclusion, so the sequence a customer sees is submitted, verifying,
    // completed — `awaiting_finality` is simply never reported, and the first
    // poll lands inside the window where the answer already exists.
    vi.useFakeTimers()
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockResolvedValue('0xhash')
    submitTransaction.mockResolvedValue({ ...intent, status: 'verifying', paymentRequest: null })
    // Still verifying on the read that follows submission, settled on the next
    // one: one poll's worth of backend work, which is what inclusion costs.
    let reads = 0
    getPurchase.mockImplementation(async () => {
      if (!submitTransaction.mock.calls.length) return intent
      reads += 1
      return reads === 1
        ? { ...intent, status: 'verifying', paymentRequest: null }
        : {
            ...intent,
            status: 'completed',
            paymentRequest: null,
            purchasedPassId: 'pass_1',
            transactionHash: '0xhash',
            settlement: aSettlement(),
          }
    })

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => { await result.current.start() })
    await act(async () => { await result.current.pay() })
    expect(result.current.state.kind).toBe('VERIFYING')

    // One interval of the settling loop. Nothing here waits out a macro block,
    // and no state in between says the word "finality".
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })

    expect(result.current.state).toEqual(
      expect.objectContaining({ kind: 'COMPLETE', passId: 'pass_1' }),
    )
    // The pass is the customer's even though the payment is still provisional:
    // gating on that would put the old wait straight back.
    const settled = result.current.state
    expect('purchase' in settled ? settled.purchase?.settlement : null).toMatchObject({
      provisional: true,
    })
  })

  it('treats a wallet rejection as a cancellation, not a failure', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockRejectedValue(
      new NimiqOperationError(nimiqError('USER_REJECTED')),
    )

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await startThenPay(result)

    expect(result.current.state.kind).toBe('CANCELLED')
    expect(submitTransaction).not.toHaveBeenCalled()
  })

  it('maps insufficient funds to a definite failure', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockRejectedValue(
      new NimiqOperationError(nimiqError('INSUFFICIENT_FUNDS')),
    )

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await startThenPay(result)

    expect(result.current.state).toEqual(
      expect.objectContaining({ kind: 'FAILED', reason: 'INSUFFICIENT_FUNDS' }),
    )
  })

  it('goes UNCERTAIN — never FAILED — when the wallet result cannot be classified', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    // Something the adapter has no documented name for. It normalises to
    // `UNKNOWN`, and `UNKNOWN` cannot prove nothing was broadcast — so it must
    // not become a FAILED state with a "Try again" button beside it, which is
    // how a customer pays twice (docs/05 §62, §158).
    sendBasicTransactionWithData.mockRejectedValue(new Error('window closed mid-flight'))

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await startThenPay(result)

    expect(result.current.state.kind).toBe('UNCERTAIN')
    expect(mayRetryPayment(result.current.state)).toBe(false)
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
    getPurchase.mockImplementation(async () => {
      if (!sendBasicTransactionWithData.mock.calls.length) return intent
      throw new ApiError({ code: 'NETWORK_ERROR', message: 'offline' })
    })

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await startThenPay(result)

    expect(result.current.state.kind).toBe('UNCERTAIN')
  })

  it('refuses to pay an intent issued for a different network', async () => {
    const foreign = {
      ...intent,
      paymentRequest: { ...intent.paymentRequest!, network: 'MAINNET' as const },
    }
    createPurchaseIntent.mockResolvedValue(foreign)
    getPurchase.mockResolvedValue(foreign)
    beginWalletAttempt.mockResolvedValue(foreign)

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await startThenPay(result)

    expect(result.current.error).toMatch(/Network mismatch/)
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('carries an idempotency key on intent creation, where the contract wants one', async () => {
    createPurchaseIntent.mockResolvedValue(intent)

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    expect(createPurchaseIntent.mock.calls[0]?.[1]?.idempotencyKey).toBeTruthy()
  })

  it('never produces a pass id the backend did not return', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    sendBasicTransactionWithData.mockResolvedValue('0xhash')
    submitTransaction.mockResolvedValue({ ...intent, status: 'pass_provisioning', paymentRequest: null, purchasedPassId: null })
    getPurchase.mockResolvedValue({ ...intent, status: 'pass_provisioning', paymentRequest: null, purchasedPassId: null })

    const { result } = renderHook(() => usePurchaseFlow('pkg_1'), { wrapper })
    await startThenPay(result)

    // Payment settled, pass not provisioned yet: the UI waits rather than
    // inventing a pass (docs/05 §54).
    expect(result.current.state.kind).toBe('PASS_CREATING')
  })
})

describe('cross-device purchase safety', () => {
  it('polls an unpaid desktop intent and observes the phone completing it without paying again', async () => {
    vi.useFakeTimers()
    createPurchaseIntent.mockResolvedValue(intent)
    getPurchase.mockResolvedValue({ ...intent, status: 'completed', paymentRequest: null, purchasedPassId: 'owned-pass' })
    const { result } = renderHook(() => usePurchaseFlow(intent.passId), { wrapper })
    await act(async () => { await result.current.start() })
    expect(result.current.state.kind).toBe('INTENT_CREATED')
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(result.current.state.kind).toBe('COMPLETE')
    expect(createPurchaseIntent).toHaveBeenCalledTimes(1)
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('resumes the handoff by identifier without creating another intent', async () => {
    const { result } = renderHook(() => usePurchaseFlow(undefined, intent.purchaseIntentId), { wrapper })
    await act(async () => { await result.current.resume(intent.purchaseIntentId) })
    expect(result.current.state.kind).toBe('INTENT_CREATED')
    expect(createPurchaseIntent).not.toHaveBeenCalled()
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('refuses a customer identity mismatch before dispatch', async () => {
    const wrong = { ...intent, customerWallet: 'NQ WRONG WALLET' }
    createPurchaseIntent.mockResolvedValue(wrong)
    getPurchase.mockResolvedValue(wrong)
    const { result } = renderHook(() => usePurchaseFlow(intent.passId), { wrapper })
    await act(async () => { await result.current.start() })
    await act(async () => { await result.current.pay() })
    expect(result.current.error).toMatch(/another wallet/)
    expect(beginWalletAttempt).not.toHaveBeenCalled()
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('keeps a lost dispatch response uncertain and never opens the wallet', async () => {
    createPurchaseIntent.mockResolvedValue(intent)
    beginWalletAttempt.mockRejectedValue(new Error('Connection lost'))
    const { result } = renderHook(() => usePurchaseFlow(intent.passId), { wrapper })
    await act(async () => { await result.current.start() })
    await act(async () => { await result.current.pay() })
    expect(result.current.state.kind).toBe('UNCERTAIN')
    expect(releaseWalletAttempt).not.toHaveBeenCalled()
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
    expect(mayRetryPayment(result.current.state)).toBe(false)
  })

  it('treats a dispatch the backend refused as a definite non-payment, not an uncertainty', async () => {
    // The backend *answered*, so it never granted the lock and the wallet was
    // never asked: nothing was broadcast. Telling a customer their money might
    // have moved here would be false, and it would lock a Buy button that is
    // safe to press. Contrast with the lost-response case above, which stays
    // uncertain precisely because there was no answer.
    createPurchaseIntent.mockResolvedValue(intent)
    beginWalletAttempt.mockRejectedValue(
      new ApiError({ code: 'INTENT_EXPIRED', message: 'Purchase intent expired', status: 410 }),
    )
    const { result } = renderHook(() => usePurchaseFlow(intent.passId), { wrapper })
    await act(async () => { await result.current.start() })
    await act(async () => { await result.current.pay() })

    expect(result.current.state.kind).toBe('FAILED')
    expect(result.current.state).toMatchObject({ reason: 'INTENT_EXPIRED' })
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
    expect(releaseWalletAttempt).not.toHaveBeenCalled()
  })

  it('refuses the dispatch itself when the purchase is no longer payable', async () => {
    // A conflict is the backend saying a dispatch was already granted, or a
    // candidate hash already exists. Still never broadcast from here, and the
    // record the flow holds is what the screen reports.
    createPurchaseIntent.mockResolvedValue(intent)
    beginWalletAttempt.mockRejectedValue(
      new ApiError({ code: 'PAYMENT_CONFLICT', message: 'Payment state conflict', status: 409 }),
    )
    const { result } = renderHook(() => usePurchaseFlow(intent.passId), { wrapper })
    await act(async () => { await result.current.start() })
    await act(async () => { await result.current.pay() })

    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
    expect(releaseWalletAttempt).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/conflict/i)
  })

  it('asks the backend once, not twice, before opening the wallet', async () => {
    // There used to be a `GET /purchases/{id}` in front of the dispatch, which
    // put a whole sequential round trip between the customer pressing Approve
    // and anything happening. Every condition it checked is re-checked by the
    // backend under the row lock that grants the dispatch, so it bought
    // latency and nothing else.
    createPurchaseIntent.mockResolvedValue(intent)
    beginWalletAttempt.mockResolvedValue(intent)
    submitTransaction.mockResolvedValue({ ...intent, status: 'verifying', paymentRequest: null })
    const { result } = renderHook(() => usePurchaseFlow(intent.passId), { wrapper })
    await act(async () => { await result.current.start() })
    getPurchase.mockClear()
    await act(async () => { await result.current.pay() })

    expect(beginWalletAttempt).toHaveBeenCalledTimes(1)
    expect(sendBasicTransactionWithData).toHaveBeenCalledTimes(1)
    // Reads that happen *after* the submission are the settlement poll, not a
    // pre-flight: none may precede the dispatch.
    const before = getPurchase.mock.invocationCallOrder[0]
    const dispatched = beginWalletAttempt.mock.invocationCallOrder[0]!
    expect(before === undefined || before > dispatched).toBe(true)
  })

  it('resubmits a stored public hash after reload and never repeats the wallet payment', async () => {
    const hash = 'a'.repeat(64)
    const key = `nimpass:payment:${intent.customerWallet}:${intent.purchaseIntentId}`
    localStorage.setItem(key, hash)
    getPurchase.mockResolvedValue({ ...intent, status: 'uncertain_retryable', paymentRequest: null })
    submitTransaction.mockResolvedValue({ ...intent, status: 'verifying', paymentRequest: null })
    const { result } = renderHook(() => usePurchaseFlow(undefined, intent.purchaseIntentId), { wrapper })
    await act(async () => { await result.current.resume(intent.purchaseIntentId) })
    expect(submitTransaction).toHaveBeenCalledWith(intent.purchaseIntentId, { txHash: hash })
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
    expect(localStorage.getItem(key)).toBeNull()
  })
})
