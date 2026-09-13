import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Verifies the adapter against the official Nimiq Provider API.
 *
 * The test double sits at the SDK boundary (`@nimiq/mini-app-sdk`), which is
 * the only place Nimpass touches Nimiq. Everything asserted below — argument
 * names, return shapes, which calls open a native dialog, and the two
 * documented error names — comes from
 * https://nimiq.dev/mini-apps/api-reference/nimiq-provider
 */

const init = vi.fn()

vi.mock('@nimiq/mini-app-sdk', () => ({ init: (...args: unknown[]) => init(...args) }))

interface FakeProvider {
  listAccounts: ReturnType<typeof vi.fn>
  sign: ReturnType<typeof vi.fn>
  isConsensusEstablished: ReturnType<typeof vi.fn>
  getBlockNumber: ReturnType<typeof vi.fn>
  sendBasicTransaction: ReturnType<typeof vi.fn>
  sendBasicTransactionWithData: ReturnType<typeof vi.fn>
}

function fakeProvider(overrides: Partial<FakeProvider> = {}): FakeProvider {
  return {
    listAccounts: vi.fn(async () => ['NQ07 0000 0000 0000 0000 0000 0000 0000 0081']),
    sign: vi.fn(async () => ({ publicKey: 'ab12', signature: 'cd34' })),
    isConsensusEstablished: vi.fn(async () => true),
    getBlockNumber: vi.fn(async () => 3_456_789),
    sendBasicTransaction: vi.fn(async () => 'a'.repeat(64)),
    sendBasicTransactionWithData: vi.fn(async () => 'b'.repeat(64)),
    ...overrides,
  }
}

async function loadAdapter() {
  const adapter = await import('./client')
  adapter.resetNimiq()
  return adapter
}

beforeEach(() => {
  vi.resetModules()
  init.mockReset()
})

afterEach(() => {
  Reflect.deleteProperty(window, 'nimiqPay')
})

describe('adapter → official Nimiq Provider API', () => {
  it('obtains the provider only through the SDK init() helper', async () => {
    const provider = fakeProvider()
    init.mockResolvedValue(provider)

    const { initNimiq } = await loadAdapter()
    const result = await initNimiq({ timeoutMs: 50 })

    expect(init).toHaveBeenCalledTimes(1)
    // The documented option is `timeout`.
    expect(init).toHaveBeenCalledWith({ timeout: 50 })
    expect(result.capabilities.walletOperationsAvailable).toBe(true)
  })

  it('maps listAccounts() to string[] of user-friendly addresses', async () => {
    init.mockResolvedValue(fakeProvider())

    const { initNimiq, listAccounts } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    await expect(listAccounts()).resolves.toEqual([
      'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
    ])
  })

  it('passes sign() the message verbatim and returns { publicKey, signature }', async () => {
    const provider = fakeProvider()
    init.mockResolvedValue(provider)

    const { initNimiq, signMessage } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    const message = 'Nimpass Wallet Authentication\n\nChallenge: abc123'
    const signed = await signMessage(message)

    // The backend composes and later reconstructs this text; the adapter must
    // not reshape it (docs/09-SECURITY.md §14, §18).
    expect(provider.sign).toHaveBeenCalledWith(message)
    expect(signed).toEqual({ publicKey: 'ab12', signature: 'cd34' })
  })

  it('sends sendBasicTransactionWithData() exactly the documented parameters', async () => {
    const provider = fakeProvider()
    init.mockResolvedValue(provider)

    const { initNimiq, sendBasicTransactionWithData } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    const hash = await sendBasicTransactionWithData({
      recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      value: 25_000_000,
      data: 'NP:0123456789abcdef0123456789abcdef',
    })

    expect(provider.sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      value: 25_000_000,
      data: 'NP:0123456789abcdef0123456789abcdef',
    })
    // `value` is integer Luna, never a NIM decimal.
    const [args] = provider.sendBasicTransactionWithData.mock.calls[0] as [{ value: number }]
    expect(Number.isInteger(args.value)).toBe(true)
    // Returns a transaction hash string.
    expect(hash).toBe('b'.repeat(64))
  })

  it('batches the two read-only calls and never lets them fail a purchase', async () => {
    const provider = fakeProvider()
    init.mockResolvedValue(provider)

    const { initNimiq, getNetworkReadiness } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    await expect(getNetworkReadiness()).resolves.toEqual({
      consensusEstablished: true,
      blockNumber: 3_456_789,
    })
    expect(provider.isConsensusEstablished).toHaveBeenCalled()
    expect(provider.getBlockNumber).toHaveBeenCalled()
  })

  it('reports "not established" instead of throwing when the probe fails', async () => {
    init.mockResolvedValue(
      fakeProvider({
        isConsensusEstablished: vi.fn(async () => {
          throw new Error('node unreachable')
        }),
      }),
    )

    const { initNimiq, getNetworkReadiness } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    await expect(getNetworkReadiness()).resolves.toEqual({
      consensusEstablished: false,
      blockNumber: null,
    })
  })
})

describe('documented provider errors', () => {
  it('normalises a thrown PermissionDeniedError to a user rejection', async () => {
    init.mockResolvedValue(
      fakeProvider({
        sendBasicTransactionWithData: vi.fn(async () => {
          throw Object.assign(new Error('User rejected'), { name: 'PermissionDeniedError' })
        }),
      }),
    )

    const { initNimiq, sendBasicTransactionWithData } = await loadAdapter()
    const { NimiqOperationError } = await import('./errors')
    await initNimiq({ timeoutMs: 50 })

    const error = (await sendBasicTransactionWithData({
      recipient: 'NQ07',
      value: 1,
      data: 'x',
    }).then(
      () => null,
      (e: unknown) => e as InstanceType<typeof NimiqOperationError>,
    ))!

    expect(error.kind).toBe('USER_REJECTED')
    expect(error.isUserRejection).toBe(true)
  })

  it('normalises InvalidTransactionError distinctly from a rejection', async () => {
    init.mockResolvedValue(
      fakeProvider({
        sendBasicTransactionWithData: vi.fn(async () => ({
          error: { type: 'InvalidTransactionError', message: 'malformed' },
        })),
      }),
    )

    const { initNimiq, sendBasicTransactionWithData } = await loadAdapter()
    const { NimiqOperationError } = await import('./errors')
    await initNimiq({ timeoutMs: 50 })

    const error = (await sendBasicTransactionWithData({
      recipient: 'NQ07',
      value: 1,
      data: 'x',
    }).then(
      () => null,
      (e: unknown) => e as InstanceType<typeof NimiqOperationError>,
    ))!

    expect(error.kind).toBe('INVALID_TRANSACTION')
    expect(error.isUserRejection).toBe(false)
  })

  it('handles the in-band { error } envelope as well as a throw', async () => {
    init.mockResolvedValue(
      fakeProvider({
        listAccounts: vi.fn(async () => ({
          error: { type: 'PermissionDeniedError', message: 'denied' },
        })),
      }),
    )

    const { initNimiq, listAccounts } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    await expect(listAccounts()).rejects.toMatchObject({ kind: 'USER_REJECTED' })
  })

  it('refuses wallet operations when no provider was injected', async () => {
    init.mockRejectedValue(new Error('no provider'))

    const { initNimiq, signMessage } = await loadAdapter()
    const result = await initNimiq({ timeoutMs: 20 })

    expect(result.provider).toBeNull()
    await expect(signMessage('hello')).rejects.toMatchObject({ kind: 'PROVIDER_UNAVAILABLE' })
  })
})
