/**
 * Checkout device classification — the one place Nimpass decides whether a
 * purchase is paid *here* or paid *on a phone*.
 *
 * ## What this is for, and what it is emphatically not for
 *
 * One purchase lifecycle, two ways to start the blockchain transaction:
 *
 *   mobile   →  the injected Nimiq provider, `sendBasicTransactionWithData()`
 *   desktop  →  a QR the customer opens with their phone, which pays the *same*
 *               Purchase Intent
 *
 * Everything downstream is shared: the same intent, the same server-snapshotted
 * recipient and price, the same `NP1:` reference, the same network, the same
 * verification pipeline, the same finality rule, the same Pass issuance, the
 * same duplicate protection. Only the initiation gesture differs.
 *
 * So this module is **UX routing and nothing else**. It is never consulted for
 * identity, permission, pass ownership or authorisation — those are decided by
 * the backend against a session cookie, and a customer who lies about their
 * device gains exactly nothing (docs/09-SECURITY.md §11, §19, §30, §37). A
 * misclassification costs a customer an awkward screen, never a wrong Pass.
 *
 * ## Why not `requestDeviceIdentifier()`
 *
 * The SDK's device identifier is a pseudonymous per-origin hash. It identifies
 * *a* device; it says nothing about whether that device is a phone or a laptop,
 * and it prompts the user for consent. Using it here would be both wrong and
 * rude.
 *
 * ## Why `insideNimiqPay` is a signal and not a contradiction
 *
 * Nimiq Pay is a phone application — iOS and Android only. Its WebView is
 * therefore conclusive evidence about the *device*, in the same way a
 * `Mobile Safari` user-agent is, and it is the only signal that cannot be
 * spoofed by a desktop browser's device-emulation mode. Reading it here is not
 * "detect the provider and branch on it": the provider does not choose the
 * flow, the device class does, and every other signal below is an ordinary
 * browser signal. It is passed in as a plain boolean rather than read from
 * wallet state so this module stays a pure function of its inputs.
 *
 * ## Policy: a tablet is a mobile checkout
 *
 * The question this classification actually answers is "can this device run
 * Nimiq Pay and confirm a payment natively?" Nimiq Pay ships for iPad and for
 * Android tablets, so both are `mobile`. That includes an iPad running
 * "Request Desktop Website", which reports a Macintosh user-agent and is caught
 * by its touch points instead.
 *
 * ## Policy: desktop is the safe default
 *
 * When the signals are inconclusive the answer is `desktop`, because the two
 * mistakes are not symmetrical. A desktop shown the QR flow is merely one hop
 * from paying — the phone completes it. A phone-less desktop shown the mobile
 * flow is a dead end: there is no injected provider, so there is no transaction
 * to initiate and nothing on screen can rescue it.
 */

export type CheckoutDevice = 'mobile' | 'desktop'

/**
 * The browser facts the classification reads.
 *
 * Kept as plain data so the rules below are a pure function: every case in
 * `checkout-device.test.ts` is one of these records, and no test has to
 * impersonate a `navigator`.
 */
export interface CheckoutDeviceSignals {
  /** `navigator.userAgent`. */
  userAgent: string
  /**
   * `navigator.userAgentData?.mobile`, or null where the API is absent.
   *
   * Chromium-only, and deliberately consulted *after* the user-agent rules:
   * Chrome on an Android tablet reports `mobile: false`, which under this
   * module's tablet policy would be the wrong answer on its own.
   */
  userAgentDataMobile: boolean | null
  /** `navigator.maxTouchPoints`. The iPadOS desktop-mode tell. */
  maxTouchPoints: number
  /** `matchMedia('(pointer: coarse)')` — a finger rather than a mouse. */
  coarsePointer: boolean
  /** `window.innerWidth`, in CSS pixels. */
  viewportWidth: number
  /** True inside the Nimiq Pay WebView. See the note above. */
  insideNimiqPay: boolean
}

/**
 * Below this width a coarse pointer is taken to mean a handheld rather than a
 * touchscreen laptop or a kiosk. Only the last rule uses it — a viewport is the
 * weakest signal here, because a narrow desktop window is still a desktop.
 */
const HANDHELD_MAX_WIDTH = 1024

/** User-agents that name a handheld outright. */
const MOBILE_UA = /\b(?:Android|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini)\b/i

/** iPads that still say so. iPadOS 13+ in desktop mode does not; see below. */
const IPAD_UA = /\biPad\b/i

/** Desktop macOS and iPadOS "Request Desktop Website" share this token. */
const MACINTOSH_UA = /\bMacintosh\b/i

/**
 * Classifies one checkout, deterministically, from browser signals alone.
 *
 * The order matters and is the whole specification — the first rule that
 * matches wins:
 *
 *   1. Inside Nimiq Pay        → mobile   (a phone app; conclusive)
 *   2. A handheld user-agent   → mobile
 *   3. An iPad user-agent      → mobile   (tablet policy)
 *   4. Macintosh with touch    → mobile   (iPadOS in desktop mode)
 *   5. `userAgentData.mobile`  → whatever it says
 *   6. Coarse pointer, touch, narrow viewport → mobile
 *   7. otherwise               → desktop  (the safe default)
 */
export function classifyCheckoutDevice(signals: CheckoutDeviceSignals): CheckoutDevice {
  const ua = signals.userAgent ?? ''

  if (signals.insideNimiqPay) return 'mobile'
  if (MOBILE_UA.test(ua)) return 'mobile'
  if (IPAD_UA.test(ua)) return 'mobile'
  // An iPad asked to "Request Desktop Website" is indistinguishable from a Mac
  // by user-agent alone. A Mac has no touch screen, so touch points settle it.
  // `> 1` rather than `> 0`: a Mac with a connected touch device can report 1.
  if (MACINTOSH_UA.test(ua) && signals.maxTouchPoints > 1) return 'mobile'
  if (signals.userAgentDataMobile !== null) return signals.userAgentDataMobile ? 'mobile' : 'desktop'
  // Last resort, for a browser that names nothing useful. All three clauses are
  // required: a touchscreen laptop has a coarse pointer and touch points but a
  // wide viewport, and a narrow desktop window has neither of the first two.
  if (signals.coarsePointer && signals.maxTouchPoints > 0 && signals.viewportWidth < HANDHELD_MAX_WIDTH) {
    return 'mobile'
  }
  return 'desktop'
}

/**
 * Reads the signals from the live browser.
 *
 * Separated from the rules so the rules stay pure. On a server or a runtime
 * missing these APIs this returns values that classify as `desktop`, which is
 * the safe default above.
 */
export function readCheckoutDeviceSignals(insideNimiqPay: boolean): CheckoutDeviceSignals {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      userAgent: '',
      userAgentDataMobile: null,
      maxTouchPoints: 0,
      coarsePointer: false,
      viewportWidth: 0,
      insideNimiqPay,
    }
  }

  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  return {
    userAgent: navigator.userAgent ?? '',
    userAgentDataMobile: typeof uaData?.mobile === 'boolean' ? uaData.mobile : null,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    coarsePointer:
      typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : false,
    viewportWidth: window.innerWidth ?? 0,
    insideNimiqPay,
  }
}
