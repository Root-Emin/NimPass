import { QrCode } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { MobileCheckoutSheet } from '@/components/payment/mobile-checkout-sheet'
import type { MobileCheckoutSheetState } from '@/components/payment/mobile-checkout-visibility'
import { MobileHandoff, NativeCheckout } from '@/components/payment/mobile-checkout'
import { QrCheckoutModal } from '@/components/payment/qr-checkout-modal'
import { useCheckoutRoute } from '@/hooks/use-checkout-device'
import type { PurchaseFlow } from '@/hooks/use-purchase-flow'
import type { PassListing, Purchase } from '@/types/domain'
import type { PaymentState } from '@/types/payment'

/**
 * One purchase lifecycle; two ways to start the transaction.
 *
 * ```
 *                        Buy Pass
 *                           │
 *          create or recover the server-side Purchase Intent
 *                           │
 *              can a transaction start *here*?
 *              ┌────────────┴────────────┐
 *      provider injected            no provider
 *  sendBasicTransactionWithData   hand it to Nimiq Pay
 *                                  ┌──────┴──────┐
 *                               desktop        phone
 *                             payment QR     opener link
 *              └────────────┬────────────────────┘
 *                     one tx hash
 *                           │
 *        the same backend verification → finality → one Pass
 * ```
 *
 * The first branch is **capability**, not screen size — see
 * `src/lib/checkout-route.ts` for why "mobile ⇒ native checkout" is false. A
 * phone browsing Nimpass outside Nimiq Pay has a phone-shaped viewport and no
 * provider at all; offering it "Approve in Nimiq Pay" would be offering a
 * button with nothing behind it.
 *
 * The device class survives as the *second* question, which is all it can
 * honestly answer: how to hand the payment over. A desktop shows a code for
 * the phone in the room; a phone shows a link for itself, because the device
 * that would scan a code is the one displaying it.
 *
 * Neither branch is a separate payment system. The intent already exists, both
 * paths pay the same one, and nothing here touches identity, authorisation or
 * Pass ownership.
 *
 * ## Inline, or as an overlay
 *
 * `listing` decides. Where the checkout *is* the page — `/purchases/{id}`,
 * opened from the Nimiq Pay handoff, which holds nothing else — the mobile
 * branch renders inline, because there is nothing to scroll past and a dialog
 * over a one-item page is ceremony.
 *
 * On a pass page there is a great deal to scroll past: the purchase panel sits
 * at the bottom of a long mobile layout, so a review rendered into it appeared
 * below the fold and the customer had to go and find the step they had just
 * asked for. Passing the listing turns the mobile branch into a sheet that
 * comes to them instead (`MobileCheckoutSheet`). The desktop branch is a modal
 * either way and is unaffected.
 */
export function PurchaseCheckout({
  flow,
  listing,
  sheet,
}: {
  flow: PurchaseFlow
  /** The pass being bought. Present ⇒ the mobile branch opens as a sheet. */
  listing?: PassListing
  /** The sheet's visibility, owned by the page that renders the panel. */
  sheet?: MobileCheckoutSheetState
}) {
  const route = useCheckoutRoute()
  const purchase = purchaseOf(flow.state)

  if (route === 'qr') {
    return purchase ? <DesktopCheckout flow={flow} purchase={purchase} /> : null
  }

  // The sheet handles its own visibility, including the moment before an intent
  // exists — which is the press the customer is waiting on.
  if (listing && sheet) {
    return <MobileCheckoutSheet flow={flow} listing={listing} route={route} sheet={sheet} />
  }

  if (!purchase) return null

  // Past the intent there is nothing left to review: once the wallet has been
  // asked, the payment state view is the whole screen.
  if (flow.state.kind !== 'INTENT_CREATED') return null

  return route === 'native' ? (
    <NativeCheckout flow={flow} purchase={purchase} />
  ) : (
    <MobileHandoff purchase={purchase} />
  )
}

/**
 * The desktop branch: the QR modal, and a way back into it.
 *
 * The modal opens by itself as soon as the intent exists — the customer pressed
 * Buy and this is what pressing Buy does — and stays open through detection,
 * verification, finality and success, so the confirmation lands in the same
 * place they have been watching. Closing it never abandons the purchase: the
 * flow keeps polling, the panel behind still reports, and the button below
 * brings the code back.
 */
function DesktopCheckout({ flow, purchase }: { flow: PurchaseFlow; purchase: Purchase }) {
  const [open, setOpen] = useState(false)
  const openedFor = useRef<string | null>(null)
  const intentId = purchase.purchaseIntentId
  const settled = flow.state.kind === 'IDLE'

  // Open once per intent. Re-opening on every render would fight the customer's
  // own close; opening on a *new* intent is what a second Buy press means.
  useEffect(() => {
    if (settled || openedFor.current === intentId) return
    openedFor.current = intentId
    setOpen(true)
  }, [intentId, settled])

  const payable = flow.state.kind === 'INTENT_CREATED'

  return (
    <>
      <QrCheckoutModal
        flow={flow}
        purchase={purchase}
        passTitle={purchase.passTitle}
        open={open}
        onClose={() => setOpen(false)}
      />
      {!open && payable ? (
        <Button block variant="secondary" onClick={() => setOpen(true)}>
          <QrCode aria-hidden="true" />
          Show payment code
        </Button>
      ) : null}
    </>
  )
}

/** The purchase a state carries, when it carries one. */
function purchaseOf(state: PaymentState): Purchase | null {
  return 'purchase' in state ? state.purchase : null
}
