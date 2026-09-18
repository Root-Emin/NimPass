import { describe, expect, it } from 'vitest'

import {
  classifyCheckoutDevice,
  readCheckoutDeviceSignals,
  type CheckoutDeviceSignals,
} from './checkout-device'

/**
 * The classification table.
 *
 * These cases are the specification: a change to the rules that is not also a
 * change here is a change nobody decided on. Real user-agent strings are used
 * throughout, because the rules are only worth anything against the strings
 * browsers actually send.
 */

function signals(overrides: Partial<CheckoutDeviceSignals> = {}): CheckoutDeviceSignals {
  return {
    userAgent: '',
    userAgentDataMobile: null,
    maxTouchPoints: 0,
    coarsePointer: false,
    viewportWidth: 1440,
    insideNimiqPay: false,
    ...overrides,
  }
}

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 14; SM-X810) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  ipad:
    'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ with "Request Desktop Website" — byte-identical to a Mac.
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  mac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  firefoxAndroid:
    'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
}

describe('phones pay natively', () => {
  it('classifies an iPhone as mobile', () => {
    expect(
      classifyCheckoutDevice(
        signals({ userAgent: UA.iphone, maxTouchPoints: 5, coarsePointer: true, viewportWidth: 390 }),
      ),
    ).toBe('mobile')
  })

  it('classifies an Android phone as mobile', () => {
    expect(
      classifyCheckoutDevice(
        signals({
          userAgent: UA.androidPhone,
          userAgentDataMobile: true,
          maxTouchPoints: 5,
          coarsePointer: true,
          viewportWidth: 412,
        }),
      ),
    ).toBe('mobile')
  })

  it('classifies Firefox on Android as mobile, which reports no userAgentData', () => {
    expect(
      classifyCheckoutDevice(
        signals({ userAgent: UA.firefoxAndroid, maxTouchPoints: 5, coarsePointer: true, viewportWidth: 412 }),
      ),
    ).toBe('mobile')
  })
})

describe('desktops get the QR', () => {
  it.each([
    ['macOS', UA.mac],
    ['Windows', UA.windows],
    ['Linux', UA.linux],
  ])('classifies %s as desktop', (_name, userAgent) => {
    expect(classifyCheckoutDevice(signals({ userAgent, userAgentDataMobile: false }))).toBe(
      'desktop',
    )
  })

  it('keeps a touchscreen Windows laptop on the desktop flow', () => {
    // Touch and a coarse pointer, but a laptop-sized viewport and an explicit
    // `mobile: false`. It cannot run Nimiq Pay, so the QR is the only route
    // that actually ends in a payment.
    expect(
      classifyCheckoutDevice(
        signals({
          userAgent: UA.windows,
          userAgentDataMobile: false,
          maxTouchPoints: 10,
          coarsePointer: true,
          viewportWidth: 1536,
        }),
      ),
    ).toBe('desktop')
  })

  it('does not turn a desktop into a phone when its window is narrow', () => {
    // A resized browser window is a layout question, not a device question.
    expect(
      classifyCheckoutDevice(
        signals({ userAgent: UA.mac, userAgentDataMobile: false, viewportWidth: 420 }),
      ),
    ).toBe('desktop')
  })
})

describe('tablets are a mobile checkout', () => {
  // Policy, stated in `checkout-device.ts`: Nimiq Pay ships for tablets, so a
  // tablet can confirm natively and should not be sent to find a second device.

  it('classifies an iPad as mobile', () => {
    expect(
      classifyCheckoutDevice(
        signals({ userAgent: UA.ipad, maxTouchPoints: 5, coarsePointer: true, viewportWidth: 820 }),
      ),
    ).toBe('mobile')
  })

  it('classifies an iPad in desktop mode as mobile, by its touch points', () => {
    // The user-agent is a Mac's, exactly. Touch is the only thing that differs,
    // and without this rule every "Request Desktop Website" iPad is handed a QR
    // code to scan with itself.
    expect(
      classifyCheckoutDevice(
        signals({
          userAgent: UA.ipadDesktopMode,
          maxTouchPoints: 5,
          coarsePointer: true,
          viewportWidth: 1024,
        }),
      ),
    ).toBe('mobile')
  })

  it('leaves a real Mac on desktop even with a touch peripheral attached', () => {
    expect(
      classifyCheckoutDevice(signals({ userAgent: UA.mac, userAgentDataMobile: false, maxTouchPoints: 1 })),
    ).toBe('desktop')
  })

  it('classifies an Android tablet as mobile despite userAgentData saying mobile: false', () => {
    // Chrome reports `mobile: false` for Android tablets. The user-agent rule
    // runs first on purpose — the device still runs Nimiq Pay.
    expect(
      classifyCheckoutDevice(
        signals({
          userAgent: UA.androidTablet,
          userAgentDataMobile: false,
          maxTouchPoints: 5,
          coarsePointer: true,
          viewportWidth: 1000,
        }),
      ),
    ).toBe('mobile')
  })
})

describe('inside Nimiq Pay', () => {
  it('is always mobile, whatever the WebView reports', () => {
    // Nimiq Pay is a phone application. Its WebView can carry an unhelpful
    // user-agent; the host is the stronger fact.
    expect(
      classifyCheckoutDevice(
        signals({ userAgent: UA.mac, userAgentDataMobile: false, insideNimiqPay: true }),
      ),
    ).toBe('mobile')
  })
})

describe('when the browser tells us nothing', () => {
  it('defaults to desktop', () => {
    // The asymmetry argument: a desktop shown the QR is one hop from paying, a
    // desktop shown "approve in Nimiq Pay" is stuck.
    expect(classifyCheckoutDevice(signals())).toBe('desktop')
  })

  it('reads live browser signals without throwing where the APIs are missing', () => {
    const read = readCheckoutDeviceSignals(false)
    expect(read.insideNimiqPay).toBe(false)
    expect(classifyCheckoutDevice(read)).toBe('desktop')
  })

  it('carries the Nimiq Pay flag straight through the live read', () => {
    expect(classifyCheckoutDevice(readCheckoutDeviceSignals(true))).toBe('mobile')
  })
})
