import { describe, expect, it } from 'vitest'

import { classifyCheckoutRoute } from './checkout-route'

/**
 * The capability rule, on its own.
 *
 * The bug this file exists to prevent is a phone-shaped screen being taken for
 * a wallet: "mobile ⇒ native checkout" puts an Approve button in front of a
 * customer whose browser has no Nimiq provider to call, and nothing on that
 * screen can rescue it.
 */
describe('classifyCheckoutRoute', () => {
  it('pays natively wherever the provider is injected, at any screen size', () => {
    expect(classifyCheckoutRoute({ transport: 'mini-app', device: 'mobile' })).toBe('native')
    // A tablet-sized Nimiq Pay WebView is still Nimiq Pay.
    expect(classifyCheckoutRoute({ transport: 'mini-app', device: 'desktop' })).toBe('native')
  })

  it('never pays natively without a provider, however phone-like the device', () => {
    // The case the old device-first rule got wrong: a phone browser.
    expect(classifyCheckoutRoute({ transport: 'hub', device: 'mobile' })).toBe('handoff')
    expect(classifyCheckoutRoute({ transport: null, device: 'mobile' })).toBe('handoff')
  })

  it('shows a payment code only where the paying device is elsewhere', () => {
    expect(classifyCheckoutRoute({ transport: 'hub', device: 'desktop' })).toBe('qr')
    expect(classifyCheckoutRoute({ transport: null, device: 'desktop' })).toBe('qr')
  })

  it('never puts a QR on the device that would have to scan it', () => {
    for (const transport of ['hub', null] as const) {
      expect(classifyCheckoutRoute({ transport, device: 'mobile' })).not.toBe('qr')
    }
  })
})
