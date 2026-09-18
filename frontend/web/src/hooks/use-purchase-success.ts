import { useCallback, useEffect, useState } from 'react'

import type { PaymentState } from '@/types/payment'

/**
 * The moment the purchase is actually done.
 *
 * ## When it opens, and why that is the whole point
 *
 * Only on `COMPLETE`. That state exists exactly once in the machine: the
 * backend verified the transaction on chain, reached finality, wrote the
 * purchase CONFIRMED and created the pass — all in the transaction whose
 * result the client is reading. It is emphatically *not* the moment
 * `sendBasicTransaction()` returned a hash, which proves only that a wallet
 * broadcast something (docs/05-NIMIQ-PAY-INTEGRATION.md §44).
 *
 * `COMPLETE` also carries `passId`, so "View Pass" links to a pass that
 * demonstrably exists rather than to an id the screen hoped for.
 *
 * ## When it is switched off
 *
 * The desktop QR checkout announces success inside the modal the customer has
 * been watching the payment in, which is deliberately where that confirmation
 * belongs — opening a second dialog over it would stack two modals and take
 * the "View Pass" link out of reach behind an inert layer. So callers on that
 * route pass `enabled: false` and the QR modal keeps the job.
 *
 * ## Why it does not come back
 *
 * A completed purchase stays completed, so the state that opens this dialog is
 * still true on every later read — a refresh, a revisit, a foreground
 * revalidation. Without a memory the customer would be congratulated again
 * every time they opened the page.
 *
 * So the purchase id is written down the first time its success is shown, and
 * the dialog opens only for an id not already there. `localStorage` is the
 * right home for it: it is a per-viewer courtesy, nothing depends on it being
 * correct, and every read and write is guarded because a private window or
 * blocked site data makes it throw. If it is unavailable the worst case is a
 * dialog the customer sees twice, never a pass that fails to appear.
 */
const SEEN_KEY = 'nimpass:purchase-celebrated'

function seenPurchases(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function rememberPurchase(id: string): void {
  try {
    const seen = seenPurchases()
    seen.add(id)
    // Bounded: this is a courtesy, not an archive. The newest few dozen are
    // all that can still be on screen.
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-50)))
  } catch {
    // No memory available. The dialog may reappear; nothing else changes.
  }
}

export interface PurchaseSuccess {
  open: boolean
  dismiss: () => void
}

/**
 * Decides whether this completion has already been celebrated.
 *
 * Separate from the dialog so a page can own the decision and a test can make
 * it without rendering anything.
 */
export function usePurchaseSuccess(
  state: PaymentState,
  options: { enabled?: boolean } = {},
): PurchaseSuccess {
  const { enabled = true } = options
  const [open, setOpen] = useState(false)
  const completedId =
    enabled && state.kind === 'COMPLETE' ? state.purchase.purchaseIntentId : null

  useEffect(() => {
    if (!completedId) return
    if (seenPurchases().has(completedId)) return
    rememberPurchase(completedId)
    setOpen(true)
  }, [completedId])

  return { open, dismiss: useCallback(() => setOpen(false), []) }
}
