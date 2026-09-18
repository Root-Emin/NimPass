import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeNimiqError, isProviderErrorResponse } from './errors'
import { HUB_ENDPOINTS, resolveHubEndpoint } from './hub-endpoint'
import { resolveInitTimeoutMs, resolveNetwork } from './network'

describe('normalizeNimiqError', () => {
  it('treats PermissionDeniedError as a user rejection, not a failure', () => {
    const error = Object.assign(new Error('User rejected the request'), {
      name: 'PermissionDeniedError',
    })
    expect(normalizeNimiqError(error).kind).toBe('USER_REJECTED')
  })

  it('classifies the SDK in-band error envelope', () => {
    const response = { error: { type: 'PermissionDeniedError', message: 'denied' } }
    expect(isProviderErrorResponse(response)).toBe(true)
    expect(normalizeNimiqError(response).kind).toBe('USER_REJECTED')
  })

  it('separates insufficient funds from generic failures', () => {
    expect(normalizeNimiqError(new Error('Insufficient balance')).kind).toBe('INSUFFICIENT_FUNDS')
    expect(normalizeNimiqError(new Error('boom')).kind).toBe('UNKNOWN')
  })

  it('never leaks the raw provider payload into the user-facing message', () => {
    const normalized = normalizeNimiqError({
      error: { type: 'RpcError', message: 'pgx: connection refused at 10.0.0.4:5432' },
    })
    expect(normalized.message).not.toContain('10.0.0.4')
    expect(normalized.message).not.toContain('pgx')
    expect(normalized.cause).toBeDefined()
  })

  it('maps timeouts and network trouble to distinct kinds', () => {
    expect(normalizeNimiqError(new Error('Request timed out')).kind).toBe('PROVIDER_TIMEOUT')
    expect(normalizeNimiqError(new Error('no consensus')).kind).toBe('NETWORK')
  })
})

describe('network configuration', () => {
  // Values are spelled as `domain.NimiqNetwork` spells them.
  it('refuses anything except an explicit MAINNET or TESTNET', () => {
    expect(() => resolveNetwork('')).toThrow(/VITE_NIMIQ_NETWORK/)
    expect(() => resolveNetwork('nonsense')).toThrow(/VITE_NIMIQ_NETWORK/)
  })

  it('only opts into mainnet on an explicit value', () => {
    expect(resolveNetwork('MAINNET')).toBe('MAINNET')
    expect(() => resolveNetwork('mainnet')).toThrow(/VITE_NIMIQ_NETWORK/)
    expect(() => resolveNetwork('main')).toThrow(/VITE_NIMIQ_NETWORK/)
    expect(resolveNetwork('TESTNET')).toBe('TESTNET')
  })

  it('falls back to a sane init timeout for missing or nonsense values', () => {
    // `undefined` intentionally reads the environment, which the test config
    // overrides — so the fallback is asserted through explicit bad input.
    expect(resolveInitTimeoutMs('')).toBe(3000)
    expect(resolveInitTimeoutMs('-1')).toBe(3000)
    expect(resolveInitTimeoutMs('not-a-number')).toBe(3000)
    expect(resolveInitTimeoutMs('500')).toBe(500)
  })
})

describe('Nimiq Hub endpoint', () => {
  /*
   * The two official endpoints (https://nimiq.dev/hub/getting-started). The
   * endpoint follows the network this build is configured for, because a
   * testnet transaction must never settle a mainnet purchase
   * (docs/09-SECURITY.md §101).
   */
  it('follows the configured network', () => {
    expect(resolveHubEndpoint('MAINNET')).toBe('https://hub.nimiq.com')
    expect(resolveHubEndpoint('TESTNET')).toBe('https://hub.nimiq-testnet.com')
    expect(HUB_ENDPOINTS.MAINNET).toBe('https://hub.nimiq.com')
    expect(HUB_ENDPOINTS.TESTNET).toBe('https://hub.nimiq-testnet.com')
  })

  it('allows a local Hub during testnet development', () => {
    expect(resolveHubEndpoint('TESTNET', 'http://localhost:8080/')).toBe('http://localhost:8080')
  })

  it('ignores an override on mainnet, where real money is at stake', () => {
    // A misconfigured build must not be able to route real payments through an
    // arbitrary origin, and "it was in the environment file" is not a reason to
    // trust one.
    expect(resolveHubEndpoint('MAINNET', 'https://not-the-hub.example')).toBe(
      'https://hub.nimiq.com',
    )
  })

  it('ignores an override that is not an http(s) URL', () => {
    expect(resolveHubEndpoint('TESTNET', 'javascript:alert(1)')).toBe(
      'https://hub.nimiq-testnet.com',
    )
    expect(resolveHubEndpoint('TESTNET', '   ')).toBe('https://hub.nimiq-testnet.com')
  })
})

describe('capability detection', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'nimiq')
    Reflect.deleteProperty(window, 'nimiqPay')
  })

  it('reports "unavailable" in an ordinary browser instead of throwing', async () => {
    const { initNimiq, resetNimiq, isInsideNimiqPay } = await import('./client')
    resetNimiq()

    expect(isInsideNimiqPay()).toBe(false)

    const result = await initNimiq({ timeoutMs: 20 })

    expect(result.provider).toBeNull()
    expect(result.error).toBeNull()
    expect(result.capabilities.nimiqProviderAvailable).toBe(false)
    expect(result.capabilities.walletOperationsAvailable).toBe(false)
    expect(result.capabilities.insideNimiqPay).toBe(false)
  })

  it('surfaces an initialization failure when the Nimiq Pay host is present', async () => {
    Object.defineProperty(window, 'nimiqPay', {
      configurable: true,
      value: { requestDeviceIdentifier: async () => 'device' },
    })

    const { initNimiq, resetNimiq, isInsideNimiqPay } = await import('./client')
    resetNimiq()

    expect(isInsideNimiqPay()).toBe(true)

    // No provider is ever injected, so init times out inside the host.
    const result = await initNimiq({ timeoutMs: 20 })

    expect(result.provider).toBeNull()
    expect(result.capabilities.insideNimiqPay).toBe(true)
    expect(result.capabilities.walletOperationsAvailable).toBe(false)
    expect(result.error).not.toBeNull()
    expect(['PROVIDER_TIMEOUT', 'PROVIDER_INIT_FAILED']).toContain(result.error?.kind)
  })

  it('shares one in-flight initialization between concurrent callers', async () => {
    const { initNimiq, resetNimiq } = await import('./client')
    resetNimiq()

    const [first, second] = await Promise.all([
      initNimiq({ timeoutMs: 20 }),
      initNimiq({ timeoutMs: 20 }),
    ])
    expect(first).toBe(second)
  })
})
