/**
 * How a purchase gets paid: the capability question, separated from the layout
 * question.
 *
 * ## The rule
 *
 * ```text
 * a Nimiq provider is injected here   -> pay here, natively
 * no provider                         -> hand the payment to Nimiq Pay
 * ```
 *
 * That is the only axis that decides whether `sendBasicTransactionWithData()`
 * can be called at all. Screen width does not decide it, and neither does a
 * user-agent: a phone browsing Nimpass in Safari has a phone-shaped screen and
 * no provider whatsoever, so "mobile ⇒ native checkout" is simply false. The
 * provider is either injected or it is not, and only one of those two states
 * can produce a transaction.
 *
 * `useCheckoutDevice()` still exists and is still used — but for what a device
 * class can honestly answer: *how* to hand the payment over. A desktop gets a
 * QR, because the phone that will pay is a different object in the room. A
 * phone gets a tap-through link, because the device that would scan the code is
 * the device displaying it. Both hand off the same intent to the same wallet,
 * and neither is a second payment flow.
 *
 * ## What this never decides
 *
 * Identity, permissions, ownership, terms, or whether a payment is valid. The
 * intent is created before any of this runs, its recipient and price are
 * snapshotted server-side, and the backend verifies the finished transaction
 * against the chain regardless of which screen produced it. A customer who
 * forges every signal this module reads gets a differently-shaped screen and no
 * payment advantage (docs/09-SECURITY.md §11, §19, §30, §37).
 */

import type { CheckoutDevice } from '@/lib/checkout-device'
import type { WalletTransportKind } from '@/types/wallet'

export type CheckoutRoute =
  /** A provider is injected: this runtime can send the transaction itself. */
  | 'native'
  /** No provider, and the paying device is elsewhere: show a payment code. */
  | 'qr'
  /** No provider, and the paying device is this one: offer the opener link. */
  | 'handoff'

export interface CheckoutRouteSignals {
  /** Which wallet transport answered, or null when none did. */
  transport: WalletTransportKind | null
  /** How the payment can be handed over, when it has to be. */
  device: CheckoutDevice
}

/**
 * Chooses the checkout surface for one purchase.
 *
 * Capability first, always: the transport decides whether a payment can start
 * here, and the device class only shapes the handoff when it cannot.
 */
export function classifyCheckoutRoute({ transport, device }: CheckoutRouteSignals): CheckoutRoute {
  if (transport === 'mini-app') return 'native'
  return device === 'desktop' ? 'qr' : 'handoff'
}
