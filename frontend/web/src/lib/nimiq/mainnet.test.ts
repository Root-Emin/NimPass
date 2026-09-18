import { describe, expect, it } from 'vitest'

import { deployment } from '../../../config/deployment'
import { LUNA_PER_NIM, nimToLuna, lunaToNimInput, formatNim } from '@/lib/format'

import { HUB_ENDPOINTS, resolveHubEndpoint } from './hub-endpoint'
import { networkLabel, resolveNetwork } from './network'

/**
 * What a Mainnet build must be, checked at the two places a wrong answer would
 * reach real money: the build-time environment guard, and the integer Luna a
 * transaction is actually sent with.
 *
 * None of this is proof of anything on chain. The frontend's network setting
 * says which deployment this bundle belongs to; the backend re-derives every
 * transaction's network from the chain itself and refuses a cross-network
 * payment outright (docs/04-NIMIQ-MINI-APPS.md §49). These tests exist so a
 * misconfigured bundle fails at build time rather than at a customer's wallet.
 */

describe('production builds are Mainnet builds', () => {
  it('accepts the two legitimate pairings and nothing else', () => {
    expect(deployment('MAINNET', 'production')).toEqual({
      network: 'MAINNET',
      environment: 'production',
    })
    expect(deployment('TESTNET', 'development')).toEqual({
      network: 'TESTNET',
      environment: 'development',
    })
    expect(deployment('TESTNET', 'test')).toEqual({ network: 'TESTNET', environment: 'test' })
  })

  it('refuses a production build pointed at Testnet', () => {
    // The failure this whole separation exists to prevent: a bundle that says
    // "production" to its users while settling against play money.
    expect(() => deployment('TESTNET', 'production')).toThrow(/Production requires MAINNET/)
  })

  it('refuses a development build pointed at Mainnet', () => {
    // The mirror image, and the more expensive one: a developer testing a flow
    // would be spending real NIM.
    expect(() => deployment('MAINNET', 'development')).toThrow(/Production requires MAINNET/)
    expect(() => deployment('MAINNET', 'test')).toThrow(/Production requires MAINNET/)
  })

  it('refuses a missing or misspelled network rather than defaulting', () => {
    for (const value of [undefined, '', 'mainnet', 'MAIN', 'Mainnet']) {
      expect(() => deployment(value, 'production')).toThrow(/VITE_NIMIQ_NETWORK/)
    }
    // `resolveNetwork()` called with no argument deliberately reads the
    // environment, so only explicit bad values are asserted here.
    for (const value of ['', 'mainnet', 'MAIN', 'Mainnet']) {
      expect(() => resolveNetwork(value)).toThrow(/VITE_NIMIQ_NETWORK/)
    }
  })

  it('refuses a missing or misspelled environment rather than defaulting', () => {
    for (const value of [undefined, '', 'prod', 'Production', 'staging']) {
      expect(() => deployment('MAINNET', value)).toThrow(/VITE_APP_ENV/)
    }
  })
})

describe('Mainnet wallet endpoints', () => {
  // The Hub is the ordinary-browser fallback only; inside Nimiq Pay the
  // injected provider is used and the Hub is never loaded.
  // Ref: https://nimiq.dev/hub/getting-started
  it('uses the Mainnet Hub for a Mainnet build', () => {
    expect(resolveHubEndpoint('MAINNET')).toBe('https://hub.nimiq.com')
    expect(HUB_ENDPOINTS.MAINNET).toBe('https://hub.nimiq.com')
  })

  it('cannot be redirected away from the Mainnet Hub by configuration', () => {
    for (const override of [
      'https://hub.nimiq-testnet.com',
      'https://not-the-hub.example',
      'http://localhost:8080',
    ]) {
      expect(resolveHubEndpoint('MAINNET', override)).toBe('https://hub.nimiq.com')
    }
  })

  it('never labels a Mainnet build as Testnet', () => {
    expect(networkLabel('MAINNET')).toBe('Nimiq Mainnet')
    expect(networkLabel('MAINNET')).not.toMatch(/test/i)
  })
})

/**
 * 1 NIM = 100,000 Luna, and every amount that reaches a transaction is an
 * integer count of Luna.
 *
 * On Mainnet this is the difference between charging a customer 12.34 NIM and
 * charging them 12.33999999999999. The conversion is asserted through the
 * values binary floating point gets wrong, because those are the only ones
 * where a lossy implementation is distinguishable from a correct one.
 */
describe('Luna is exact', () => {
  it('uses the documented ratio', () => {
    expect(LUNA_PER_NIM).toBe(100_000)
  })

  it('converts the values floating point cannot represent', () => {
    // 1.23456 * 100_000 is 123455.99999999999 in IEEE 754 doubles.
    expect(nimToLuna('1.23456')).toBe(123_456)
    expect(nimToLuna('0.00001')).toBe(1)
    expect(nimToLuna('0.07')).toBe(7_000)
    expect(nimToLuna('29.29')).toBe(2_929_000)
    expect(nimToLuna('1000')).toBe(100_000_000)
    for (const luna of [1, 7_000, 123_456, 2_929_000, 100_000_000]) {
      expect(Number.isInteger(luna)).toBe(true)
    }
  })

  it('round-trips without drift', () => {
    for (const nim of ['0.00001', '0.07', '1.23456', '29.29', '1000', '123456.78901']) {
      const luna = nimToLuna(nim)
      expect(luna).not.toBeNull()
      expect(Number.isSafeInteger(luna as number)).toBe(true)
      expect(nimToLuna(lunaToNimInput(luna as number))).toBe(luna)
    }
  })

  it('refuses amounts that are not whole Luna', () => {
    // Six decimals is finer than Luna, so there is no exact amount to charge.
    expect(nimToLuna('0.000001')).toBeNull()
    expect(nimToLuna('1.234567')).toBeNull()
    expect(nimToLuna('-1')).toBeNull()
    expect(nimToLuna('1e5')).toBeNull()
    expect(nimToLuna('')).toBeNull()
  })

  it('shows every Luna it charges', () => {
    // A price that rounds to "0 NIM" on screen is a price the customer did not
    // agree to.
    expect(formatNim(1)).toBe('0.00001 NIM')
    expect(formatNim(123_456)).toBe('1.23456 NIM')
    expect(formatNim(100_000_000)).toBe('1,000 NIM')
  })
})
