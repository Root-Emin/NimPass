import { useSyncExternalStore } from 'react'

import {
  classifyCheckoutDevice,
  readCheckoutDeviceSignals,
  type CheckoutDevice,
} from '@/lib/checkout-device'
import { classifyCheckoutRoute, type CheckoutRoute } from '@/lib/checkout-route'
import { useWallet } from '@/hooks/use-wallet'

/**
 * The checkout device class, for the one decision it exists to make: whether
 * Buy Pass initiates the transaction here or hands it to a phone.
 *
 * Every component that needs the answer reads it from here. Nothing else in the
 * application inspects a user-agent or a viewport to decide how a purchase is
 * paid — that is the point of having this hook at all (see
 * `src/lib/checkout-device.ts` for the rules and the policy behind them).
 *
 * Not a media query. `useMediaQuery` answers "how wide is the window", which is
 * a layout question; this answers "what kind of machine is this", which a
 * resized desktop window must not change the answer to.
 *
 * It does subscribe to resize, though, because one of the fallback rules reads
 * the viewport, and because a device-emulation toggle in developer tools fires
 * one. Re-classifying is a pure function over cheap reads, so the cost is
 * nothing and a stale answer would strand someone on the wrong checkout.
 */
export function useCheckoutDevice(): CheckoutDevice {
  const { capabilities } = useWallet()
  const insideNimiqPay = capabilities.insideNimiqPay

  return useSyncExternalStore(
    subscribeToViewport,
    () => classifyCheckoutDevice(readCheckoutDeviceSignals(insideNimiqPay)),
    // Server/initial render: the safe default, matching the classifier's own.
    () => 'desktop' as CheckoutDevice,
  )
}

function subscribeToViewport(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('resize', onChange)
  window.addEventListener('orientationchange', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    window.removeEventListener('orientationchange', onChange)
  }
}

/**
 * The checkout surface this runtime will use, asked once and answered the same
 * way everywhere.
 *
 * `PurchaseCheckout` needs it to choose a surface, and the screens around it
 * need it to know whether that surface already has a success announcement of
 * its own — the desktop QR modal does, and a second dialog over it would stack
 * two modals. Both now read this rather than each re-deriving the routing
 * rules (`src/lib/checkout-route.ts`).
 */
export function useCheckoutRoute(): CheckoutRoute {
  const device = useCheckoutDevice()
  const { capabilities } = useWallet()
  return classifyCheckoutRoute({ transport: capabilities.transport, device })
}
