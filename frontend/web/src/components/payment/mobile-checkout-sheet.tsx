import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import { useRef } from 'react'

import { checkoutStatus } from '@/components/payment/checkout-status'
import { PaymentStateView } from '@/components/payment/payment-state-view'
import { MobileHandoff, NativeCheckout } from '@/components/payment/mobile-checkout'
import { ReportTransaction } from '@/components/payment/report-transaction'
import { ProviderAvatar } from '@/components/provider/provider-avatar'
import { DialogOverlay, DialogPositioner } from '@/components/ui/dialog'
import { dialogPanelClass } from '@/components/ui/dialog-panel'
import type { MobileCheckoutSheetState } from '@/components/payment/mobile-checkout-visibility'
import type { PurchaseFlow } from '@/hooks/use-purchase-flow'
import type { CheckoutRoute } from '@/lib/checkout-route'
import { formatNim, formatSessions } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PassListing, Purchase } from '@/types/domain'
import { mayHaveBeenCharged } from '@/types/payment'

/**
 * The mobile checkout, as an overlay.
 *
 * ## The problem it solves
 *
 * Buying on a phone used to be: tap Buy, then discover that the review and the
 * Approve button had appeared somewhere below the fold, inside the purchase
 * panel at the bottom of a long pass page. The customer had to scroll to find
 * the step they had just asked for. On a page that also has a sticky Buy bar,
 * the commonest reading of "nothing happened" is to tap Buy again.
 *
 * So the next step comes to them. One tap opens this, immediately — before the
 * intent exists, so there is no gap where the screen is unchanged — and it
 * stays until the purchase reaches an outcome.
 *
 * ## What it is not
 *
 * Not a second checkout. The wallet call, the dispatch lock, the submission and
 * the polling all stay in `usePurchaseFlow`, and the two things a customer can
 * press are the *same components* the panel rendered before —
 * `NativeCheckout` and `MobileHandoff`, unchanged in substance and embedded
 * here rather than duplicated. This file contributes a surface and a summary,
 * and no payment logic whatsoever.
 *
 * The desktop QR modal is untouched: it is a different interaction (a code for
 * a second device) and it already opens itself.
 *
 * ## When it can be dismissed
 *
 * Only while nothing can have been sent. Past that the sheet is reporting on
 * money, and a stray tap outside must not read as "never mind" — the same rule
 * the QR modal follows, for the same reason (docs/05 §55, §62). The purchase
 * keeps being watched either way, so closing it never costs a customer
 * anything.
 */
export function MobileCheckoutSheet({
  flow,
  listing,
  route,
  sheet,
}: {
  flow: PurchaseFlow
  /** The pass being bought, for the summary above the terms. */
  listing: PassListing
  /** Which mobile surface: the native approval, or the handoff link. */
  route: Extract<CheckoutRoute, 'native' | 'handoff'>
  /** Visibility, owned by the page so the panel behind knows it is covered. */
  sheet: MobileCheckoutSheetState
}) {
  const state = flow.state
  const purchase = 'purchase' in state ? state.purchase : null
  const status = checkoutStatus(state)
  const panel = useRef<HTMLDivElement>(null)

  const { open, close } = sheet
  const dismissible = !status.committed && !mayHaveBeenCharged(state)

  if (!open) return null

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next && dismissible) close()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPositioner>
          <DialogPrimitive.Content
            ref={panel}
            className={cn(
              dialogPanelClass,
              'relative max-w-md gap-5 text-left focus:outline-none sm:p-7',
            )}
            aria-describedby={undefined}
            // The panel, not the close button: a payment screen must not open
            // with a focus ring around "dismiss" (as the QR modal does).
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              panel.current?.focus()
            }}
            onEscapeKeyDown={(event) => {
              if (!dismissible) event.preventDefault()
            }}
            onInteractOutside={(event) => {
              if (!dismissible) event.preventDefault()
            }}
          >
            <header className="space-y-1 pr-10">
              <DialogPrimitive.Title className="text-h3 font-semibold text-ink">
                {headline(state.kind)}
              </DialogPrimitive.Title>
              <p className="text-small text-ink-muted">
                {formatSessions(listing.sessions)} · {listing.provider.name}
              </p>
              {dismissible ? (
                <DialogPrimitive.Close
                  className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
                  aria-label="Close"
                >
                  <X className="size-4" aria-hidden="true" />
                </DialogPrimitive.Close>
              ) : null}
            </header>

            <PurchaseSummary listing={listing} purchase={purchase} />

            {/*
              The step itself, or the state the payment has reached.

              `PaymentStateView` is the page's own account of the purchase
              lifecycle, rendered here rather than beneath this sheet. That is
              the point: there is one vocabulary for these states and one set of
              actions attached to them, and a second sheet-shaped copy beside it
              would be two wordings for one backend fact — with the richer one
              stranded under a modal.

              `CREATING_INTENT` is the one state it has nothing for, because
              that state is about this browser rather than about a purchase. It
              is also the press the customer is waiting on, so it gets a line of
              its own.
            */}
            {purchase && state.kind === 'INTENT_CREATED' ? (
              route === 'native' ? (
                <NativeCheckout flow={flow} purchase={purchase} embedded />
              ) : (
                <MobileHandoff purchase={purchase} embedded />
              )
            ) : state.kind === 'CREATING_INTENT' ? (
              <StatusBlock label={status.label} />
            ) : (
              <PaymentStateView
                state={state}
                onCancel={flow.mayCancel ? () => void flow.cancel() : undefined}
                cancelling={flow.cancelling}
                onReconcile={() => void flow.reconcile()}
                reconciling={flow.reconciling}
              />
            )}

            {/*
              Whatever the flow last reported going wrong, in the surface the
              customer is actually looking at. The panel behind renders the same
              line for every state this sheet has closed for, so there is one of
              it on screen and it is always reachable.
            */}
            {flow.error ? (
              <p role="alert" className="text-small text-danger">
                {flow.error}
              </p>
            ) : null}

            {/*
              The way out of a payment the backend was never told about.
              
              It lives here rather than only on the page because this sheet is
              what the customer is looking at: an offer rendered underneath a
              modal is an offer nobody can take. `PurchasePanel` renders the
              same control for every state this sheet has closed for, so there
              is exactly one of it on screen at any moment.

              It gates itself — ninety seconds of an unsettled live intent —
              so the ordinary customer never meets it.
            */}
            <div className="flex justify-center">
              <ReportTransaction flow={flow} />
            </div>
          </DialogPrimitive.Content>
        </DialogPositioner>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** What the sheet is called, at each stage. It is the accessible name. */
function headline(kind: string): string {
  switch (kind) {
    case 'CREATING_INTENT':
      return 'Preparing your payment'
    case 'INTENT_CREATED':
      return 'Confirm your purchase'
    case 'COMPLETE':
      return 'Payment confirmed'
    default:
      return 'Confirming your payment'
  }
}

/**
 * What is being bought and what it costs.
 *
 * The price comes from the intent once one exists, and from the listing only
 * until then — the backend's snapshot is what will actually be charged, and the
 * catalogue's figure is what the customer was looking at
 * (docs/08-ARCHITECTURE.md §71).
 */
function PurchaseSummary({
  listing,
  purchase,
}: {
  listing: PassListing
  purchase: Purchase | null
}) {
  const priceLuna = purchase?.paymentRequest?.valueLuna ?? purchase?.priceLuna ?? listing.priceLuna

  return (
    <div className="rounded-xl border border-line bg-surface-muted/60 p-4">
      <div className="flex items-start gap-3">
        <ProviderAvatar
          wallet={listing.provider.wallet}
          avatarUrl={listing.provider.avatarUrl}
          variant={listing.provider.avatarVariant}
          name={listing.provider.name}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{listing.title}</p>
          <p className="truncate text-small text-ink-muted">{listing.provider.name}</p>
        </div>
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-small text-ink-muted">{formatSessions(listing.sessions)}</span>
        <span className="numeric font-display text-h3 font-semibold text-ink">
          {formatNim(priceLuna)}
        </span>
      </div>
    </div>
  )
}

/**
 * The one line the sheet words for itself: the gap between the tap and the
 * intent existing.
 *
 * `PaymentStateView` covers every state a *purchase* can be in, and this is not
 * one of them — there is no purchase yet, only a request in flight for one.
 */
function StatusBlock({ label }: { label: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface-muted/60 px-4 py-5 text-body text-ink"
    >
      <Loader2 className="size-4 animate-spin text-ink-muted" aria-hidden="true" />
      {label}
    </p>
  )
}
