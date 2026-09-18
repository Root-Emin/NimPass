import { afterEach, describe, expect, it, vi } from 'vitest'
import { deployment } from '../../../config/deployment'
import { purchaseHandoff, walletAttemptId } from './purchase-handoff'

const id = 'aabbccdd-0000-4000-8000-000000000001'
afterEach(() => vi.unstubAllEnvs())
describe('purchase locator', () => {
  it('puts only the purchase identifier into the official opener', () => {
    const { opener, page } = purchaseHandoff(id, 'https://nimpass.example')
    const link = new URL(opener)
    expect(link.protocol).toBe('nimiqpay:')
    expect(link.hostname).toBe('miniapp')
    expect([...link.searchParams.keys()]).toEqual(['url'])
    expect(link.searchParams.get('url')).toBe(page)
    expect(page).toBe(`https://nimpass.example/purchases/${id}`)
  })
  it('uses the LAN origin supplied by the launcher even on a localhost desktop', () => {
    vi.stubEnv('VITE_PUBLIC_ORIGIN', 'http://192.168.1.40:5173')
    expect(purchaseHandoff(id).page).toBe(`http://192.168.1.40:5173/purchases/${id}`)
  })
  it('puts the HTTPS opener in the QR, never the custom scheme a camera cannot read', () => {
    const { scan, scanOpensNimiqPay } = purchaseHandoff(id, 'https://nimpass.example')
    // Nimiq Pay's own scan button takes payment requests only (CPLink, NAKA,
    // Lightning); the QR is read by the phone camera, which needs http(s).
    expect(scan).toBe(`https://nimpay.app/miniapps/open/nimpass.example/purchases/${id}`)
    expect(scan.startsWith('nimiqpay:')).toBe(false)
    expect(scanOpensNimiqPay).toBe(true)
  })
  it('falls back to the page itself where no public opener can reach the host', () => {
    const { scan, page, scanOpensNimiqPay } = purchaseHandoff(id, 'http://192.168.1.40:5173')
    expect(scan).toBe(page)
    expect(scanOpensNimiqPay).toBe(false)
  })
  it('rejects injection and credentials in a handoff', () => {
    expect(() => purchaseHandoff(id + '?value=1')).toThrow()
    expect(() => purchaseHandoff(id, 'https://user:password@example.com')).toThrow()
    expect(() => purchaseHandoff(id, 'javascript:alert(1)')).toThrow()
  })
  it('uses secure random dispatch identifiers even without randomUUID on HTTP LAN', () => {
    expect(walletAttemptId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(walletAttemptId()).not.toBe(walletAttemptId())
  })
})
describe('explicit deployment network', () => {
  it.each([[undefined, 'development'], ['testnet', 'development'], ['TESTNET', 'production'], ['MAINNET', 'development'], ['MAINNET', undefined]])('refuses %s / %s', (network, env) => {
    expect(() => deployment(network, env)).toThrow()
  })
  it('accepts only the intended development and production combinations', () => {
    expect(deployment('TESTNET', 'development').network).toBe('TESTNET')
    expect(deployment('MAINNET', 'production').network).toBe('MAINNET')
  })
})
