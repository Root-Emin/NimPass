import { useEffect, useRef, useState } from 'react'

import type { PurchaseFlow } from '@/hooks/use-purchase-flow'
import { isSettlingPaymentState } from '@/types/payment'

/** Whether the mobile confirmation sheet is on screen, and how to put it away. */
export interface MobileCheckoutSheetState {
  open: boolean
  close: () => void
}

/**
 * Opens on the press that started this purchase, and closes when the payment
 * reaches an outcome or the customer puts it away.
 *
 * Owned by the page rather than by the sheet, because the purchase panel
 * underneath has to know when it is covered: an error line or a recovery offer
 * rendered beneath an open modal is one nobody can read or reach, and rendering
 * it in both places would put two of each in the document.
 *
 * Keyed on the intent id so a *second* Buy — a new intent after a cancellation
 * — opens it again, while a re-render of the same intent does not fight a close
 * the customer performed. The pre-intent states have no id yet, which is
 * exactly why `CREATING_INTENT` opens it unconditionally: that is the press.
 */
export function useMobileCheckoutSheet(flow: PurchaseFlow): MobileCheckoutSheetState {
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const state = flow.state
  const intentId = flow.purchaseId

  // A fresh attempt re-arms the sheet.
  const previousIntent = useRef<string | null>(intentId)
  useEffect(() => {
    if (intentId !== previousIntent.current) {
      previousIntent.current = intentId
      setClosedFor(null)
    }
  }, [intentId])

  /*
   * Open from the press until the payment reaches an outcome, and no further.
   *
   * The sheet follows the payment — that is the point of it staying up through
   * verification and finality — but it does not *report* outcomes. Success has
   * its own dialog (`PaymentSuccessModal`), and the states that need a
   * paragraph rather than a line — uncertain, refused, compensation — are
   * explained by `PaymentStateView` on the page behind, which the panel scrolls
   * into view. Keeping the sheet open over either would put one message under
   * another modal.
   */
  const wanted =
    state.kind === 'CREATING_INTENT' ||
    state.kind === 'INTENT_CREATED' ||
    state.kind === 'AWAITING_WALLET' ||
    isSettlingPaymentState(state)

  const key = intentId ?? 'pending'
  return {
    open: wanted && closedFor !== key,
    close: () => setClosedFor(key),
  }
}
