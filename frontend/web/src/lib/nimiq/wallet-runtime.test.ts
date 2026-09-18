import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Runtime selection: which wallet transport each runtime gets.
 *
 * This is the one branch in the application, and it is the compatibility
 * guarantee in miniature:
 *
 *   Nimiq Pay WebView  →  the injected provider, via `@nimiq/mini-app-sdk`
 *   ordinary browser   →  the Nimiq Hub, via `@nimiq/hub-api`
 *
 * The rule is capability detection, never user-agent guessing (docs/04
 * §60): the SDK either returns a provider or it does not. Nimiq Pay is tried
 * first and always wins, so a Mini App session can never see a Hub window.
 */

const init = vi.fn()
const hubConstructed = vi.fn()

vi.mock('@nimiq/mini-app-sdk', () => ({ init: (...args: unknown[]) => init(...args) }))

/** Set to simulate a Hub client that cannot be constructed at all. */
let hubUnavailable = false

class FakeHubApi {
  constructor(endpoint: string) {
    if (hubUnavailable) throw new Error('chunk load failed')
    hubConstructed(endpoint)
  }
  chooseAddress = vi.fn()
  signMessage = vi.fn()
  checkout = vi.fn()
}

vi.mock('@nimiq/hub-api', () => ({ default: FakeHubApi }))

function fakeProvider() {
  return {
    listAccounts: vi.fn(async () => ['NQ07 0000 0000 0000 0000 0000 0000 0000 0081']),
    sign: vi.fn(async () => ({ publicKey: 'ab', signature: 'cd' })),
    isConsensusEstablished: vi.fn(async () => true),
    getBlockNumber: vi.fn(async () => 1),
    sendBasicTransaction: vi.fn(async () => 'a'.repeat(64)),
    sendBasicTransactionWithData: vi.fn(async () => 'b'.repeat(64)),
  }
}

/** Marks the runtime as the Nimiq Pay host, the way the host itself does. */
function enterNimiqPay() {
  Object.defineProperty(window, 'nimiqPay', {
    configurable: true,
    value: { language: 'en', requestDeviceIdentifier: async () => 'device' },
  })
}

async function resolveRuntime() {
  const runtime = await import('./wallet-runtime')
  runtime.resetWalletRuntime()
  return { module: runtime, result: await runtime.initWalletRuntime() }
}

beforeEach(() => {
  vi.resetModules()
  init.mockReset()
  hubConstructed.mockReset()
  hubUnavailable = false
})

afterEach(() => {
  Reflect.deleteProperty(window, 'nimiqPay')
})

describe('inside Nimiq Pay', () => {
  it('selects the Mini App transport when the SDK returns a provider', async () => {
    enterNimiqPay()
    init.mockResolvedValue(fakeProvider())

    const { result } = await resolveRuntime()

    expect(result.transport?.kind).toBe('mini-app')
    expect(result.capabilities.transport).toBe('mini-app')
    expect(result.capabilities.walletOperationsAvailable).toBe(true)
    expect(result.capabilities.insideNimiqPay).toBe(true)
  })

  it('never loads the Hub there, so no Hub window can appear in the WebView', async () => {
    enterNimiqPay()
    init.mockResolvedValue(fakeProvider())

    await resolveRuntime()

    expect(hubConstructed).not.toHaveBeenCalled()
  })

  it('runs the whole flow behind one user action, with no gesture budget', async () => {
    enterNimiqPay()
    init.mockResolvedValue(fakeProvider())

    const { result } = await resolveRuntime()

    // Native approval sheets are not browser popups: account access and signing
    // can follow one press, exactly as they did before the Hub existed.
    expect(result.capabilities.gesturePerOperation).toBe(false)
    expect(result.transport?.gesturePerOperation).toBe(false)
  })

  it('reports the host’s own failure rather than falling back to the Hub', async () => {
    // Inside the host the wallet belongs to the host. Opening a web wallet in
    // its WebView would be a second, unrelated wallet.
    enterNimiqPay()
    init.mockRejectedValue(new Error('provider timed out'))

    const { result } = await resolveRuntime()

    expect(result.transport).toBeNull()
    expect(result.capabilities.insideNimiqPay).toBe(true)
    expect(result.error).not.toBeNull()
    expect(hubConstructed).not.toHaveBeenCalled()
  })
})

describe('in an ordinary browser', () => {
  it('selects the Hub transport when no provider is injected', async () => {
    const { result } = await resolveRuntime()

    expect(result.transport?.kind).toBe('hub')
    expect(result.capabilities.transport).toBe('hub')
    // The case that used to read as "wallet unavailable" is now a wallet.
    expect(result.capabilities.walletOperationsAvailable).toBe(true)
    expect(result.capabilities.insideNimiqPay).toBe(false)
    expect(result.error).toBeNull()
    // Waiting for Mini App init() in a normal browser delayed the first Login.
    expect(init).not.toHaveBeenCalled()
  })

  it('points the Hub at the endpoint for this build’s network', async () => {
    await resolveRuntime()

    // The test build is configured for testnet, and a testnet transaction must
    // never settle a mainnet purchase (docs/09-SECURITY.md §101).
    expect(hubConstructed).toHaveBeenCalledWith('https://hub.nimiq-testnet.com')
  })

  it('asks for a gesture per wallet window, because browsers grant one popup per click', async () => {
    const { result } = await resolveRuntime()

    expect(result.capabilities.gesturePerOperation).toBe(true)
  })

  it('keeps public browsing working when even the Hub cannot be reached', async () => {
    hubUnavailable = true

    const runtime = await import('./wallet-runtime')
    runtime.resetWalletRuntime()
    const result = await runtime.initWalletRuntime()

    // A resolved state, not a thrown one: "no wallet here" is something to
    // render (docs/08-ARCHITECTURE.md §87).
    expect(result.transport).toBeNull()
    expect(result.capabilities.walletOperationsAvailable).toBe(false)
    expect(result.error?.kind).toBe('PROVIDER_INIT_FAILED')
  })
})

describe('resolution is shared and retryable', () => {
  it('resolves once and hands every caller the same runtime', async () => {
    const runtime = await import('./wallet-runtime')
    runtime.resetWalletRuntime()

    const [first, second] = await Promise.all([
      runtime.initWalletRuntime(),
      runtime.initWalletRuntime(),
    ])
    expect(first).toBe(second)
    expect(hubConstructed).toHaveBeenCalledTimes(1)
  })

  it('exposes the resolved transport synchronously, for the click path', async () => {
    // A click handler cannot await before opening a wallet window, so the
    // transport has to already be there. `WalletProvider` resolves it on mount
    // precisely so this is true by the time anyone presses Login.
    const { module } = await resolveRuntime()

    expect(module.currentTransport()?.kind).toBe('hub')
  })

  it('reports nothing synchronously before resolution finishes', async () => {
    init.mockImplementation(() => new Promise(() => {}))

    const runtime = await import('./wallet-runtime')
    runtime.resetWalletRuntime()
    void runtime.initWalletRuntime()

    expect(runtime.currentTransport()).toBeNull()
  })
})
