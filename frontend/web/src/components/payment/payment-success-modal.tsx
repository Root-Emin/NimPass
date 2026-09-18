import { CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { PurchaseSuccess } from '@/hooks/use-purchase-success'
import { formatNim, formatSessions, shortenHash } from '@/lib/format'
import type { PaymentState } from '@/types/payment'

/**
 * Payment successful.
 *
 * Sparse on purpose (docs/03-DESIGN-SYSTEM.md §83: focused actions only). One
 * sentence saying what happened, one saying where the pass went, and the two
 * things anyone wants next. The transaction hash is a small, secondary line
 * rather than a receipt — the customer came here for a pass, not for block
 * data.
 *
 * ## Making it work at every width
 *
 * This is the screen a mobile customer reaches at the end of a purchase, and it
 * was laid out as though it were always going to be seen on a laptop. Four
 * things were wrong at 375px, and each is fixed by a rule rather than a
 * breakpoint hack:
 *
 *  - **The transaction line could not wrap, and was not short.** `shortenId`
 *    splits on the first hyphen, which a transaction hash does not have — so
 *    all 64 characters were printed, in a tabular font, as a "quiet" receipt
 *    line. `shortenHash` gives it a head and a tail. It also sits in a flex
 *    child, and a flex child's default `min-width: auto` refuses to shrink
 *    below its content, so the row grew past the panel and scrolled the dialog
 *    sideways: `min-w-0` on the column fixes that, and `break-all` is scoped to
 *    the hash alone so the words beside it stay whole. The `title` keeps the
 *    full value available.
 *  - **The title had a fixed-width neighbour.** The close button is 44px of
 *    touch target, and the heading was competing with it for a line. It now has
 *    room reserved for it.
 *  - **Sessions and price shared one line with a separator.** At narrow widths
 *    that either overflowed or broke in the middle of "12,340 NIM". They are
 *    now two items that wrap as units.
 *  - **The actions were a row that never became a column.** They are stacked
 *    and full-width below `sm`, so the primary action is a comfortable target
 *    and neither button is squeezed to its text.
 *
 * The panel itself is capped at `max-w-md` and the positioner already keeps it
 * inside the viewport with safe-area padding, so nothing here can exceed the
 * screen at any of 375, 390, 430, 768 or 1440.
 */
export function PaymentSuccessModal({
  state,
  success,
}: {
  state: PaymentState
  success: PurchaseSuccess
}) {
  if (state.kind !== 'COMPLETE') return null
  const { purchase, passId } = state

  return (
    <Dialog open={success.open} onOpenChange={(next) => (next ? undefined : success.dismiss())}>
      <DialogContent
        title="Payment successful"
        description="Your pass has been added to My Passes."
      >
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-line bg-surface-muted p-4 sm:mt-5">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
          {/* `min-w-0`: without it this flex child refuses to shrink below the
              width of the transaction hash, and the panel scrolls sideways. */}
          <div className="min-w-0 space-y-1">
            <p className="text-pretty text-body text-ink">{purchase.passTitle}</p>
            {/* Two facts, wrapping as units rather than breaking mid-number. */}
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-small text-ink-subtle">
              <span>{formatSessions(purchase.sessions)}</span>
              <span aria-hidden="true">·</span>
              <span className="numeric">{formatNim(purchase.priceLuna)} paid</span>
            </p>
            {purchase.transactionHash ? (
              /* Only the hash is allowed to break, so "verified on Nimiq" can
                 never be split into "Ni miq" at a narrow width. */
              <p className="pt-1 text-micro text-ink-subtle" title={purchase.transactionHash}>
                Transaction{' '}
                <span className="numeric break-all">{shortenHash(purchase.transactionHash)}</span>{' '}
                · verified on Nimiq
              </p>
            ) : null}
          </div>
        </div>

        {/*
          Stacked and full width on a phone, side by side from `sm`. The primary
          action is last in the DOM and first on screen below `sm`
          (`flex-col-reverse`), so it sits nearest the thumb while keeping the
          reading order "leave, or go to the pass".
        */}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:mt-6 sm:flex-row sm:justify-end">
          <Button variant="secondary" block className="sm:w-auto" onClick={success.dismiss}>
            Done
          </Button>
          <Button asChild block className="sm:w-auto" onClick={success.dismiss}>
            <Link to={`/passes/${passId}`}>View pass</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
