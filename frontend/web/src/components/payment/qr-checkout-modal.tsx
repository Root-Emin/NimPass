import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Camera, CheckCircle2, Loader2, ScanLine, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'

import { Button } from '@/components/ui/button'
import { DialogOverlay, DialogPositioner } from '@/components/ui/dialog'
import { dialogPanelClass } from '@/components/ui/dialog-panel'
import { PaymentTerms } from '@/components/payment/payment-terms'
import { checkoutStatus } from '@/components/payment/checkout-status'
import type { PurchaseFlow } from '@/hooks/use-purchase-flow'
import { purchaseHandoff } from '@/lib/nimiq/purchase-handoff'
import { verifiedPaymentUri } from '@/lib/nimiq/payment-uri'
import { formatNim } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Purchase } from '@/types/domain'
import { mayHaveBeenCharged } from '@/types/payment'

/**
 * The desktop checkout: one Purchase Intent, shown as a QR, paid from a phone.
 *
 * ## What the QR contains
 *
 * The **payment request itself**, in the official Nimiq request-link encoding:
 *
 *     nimiq:<provider address>?amount=<decimal NIM>&message=<NP1 reference>
 *
 * It is built by the backend from the Purchase Intent's immutable snapshot and
 * rendered here verbatim — `verifiedPaymentUri()` only re-checks that its
 * recipient and amount agree with the terms printed beside it, and withholds
 * the code if they do not. Nothing on this screen computes an address, a price
 * or a reference (docs/05 §13, §14, §85; ADR-006).
 *
 * Scanned in Nimiq Pay, it opens the wallet's own payment screen already
 * addressed to the provider for the exact Pass price. The customer confirms a
 * transaction their wallet prepared, and the backend finds it on chain by
 * sweeping the provider's address — no client is on that path to report a
 * hash, and none has to be. The `message` is the intent's own `NP1:`
 * reference, which is what lets the sweep tell this purchase's payment from
 * any other payment to the same provider for the same amount.
 *
 * ## What it is worth: nothing, as evidence
 *
 * The QR is convenience, not security. A customer can edit it, ignore it and
 * send any amount they like from any wallet — and the backend will refuse to
 * issue a Pass, because settlement compares the finished transaction against
 * the intent's snapshot: exact recipient, exact Luna, this intent's
 * reference, network, inclusion, macro finality and global hash uniqueness.
 * 800 NIM against a 1000 NIM Pass is rejected no matter how the payment was
 * started (docs/05 §41, §69; docs/09-SECURITY.md §30, §37).
 *
 * ## The one thing still unverified on a device
 *
 * No official source documents which payloads Nimiq Pay's in-app scanner
 * accepts, or whether a scanned link's `message` reaches the transaction's data
 * field (ADR-006 gate G1). Two things follow, and both are deliberate: the Mini
 * App opener stays on this screen as a second route to the same intent, so a
 * refused scan is never a dead end; and the backend settles a matching payment
 * whether or not the reference survived, so a scanner that drops `message`
 * cannot take a customer's money and strand it.
 *
 * ## How the desktop learns it was paid
 *
 * It does not listen to the phone, and it does not need the customer to come
 * back and tell it anything. `usePurchaseFlow` polls `GET /purchases/{id}`
 * every few seconds while the code is up, and the backend's own sweep is
 * meanwhile watching the chain — so the two halves meet on the purchase
 * record and this window changes on its own, usually within seconds of the
 * approval.
 *
 * Closing the modal does not stop that: a purchase that may have been paid
 * keeps being watched, because losing frontend state must never cost a
 * customer a second payment (docs/05 §66, §138).
 */
export function QrCheckoutModal({
  flow,
  purchase,
  passTitle,
  open,
  onClose,
}: {
  flow: PurchaseFlow
  purchase: Purchase
  passTitle: string
  open: boolean
  onClose: () => void
}) {
  const status = checkoutStatus(flow.state)
  const handoff = safeHandoff(purchase.purchaseIntentId)
  const request = purchase.paymentRequest
  // The server's payment request, re-checked against the terms shown beside it.
  // Null means we will not show a code we cannot vouch for; the opener below
  // still reaches the same purchase.
  const payment = request ? verifiedPaymentUri(request) : null
  const qr = useQrDataUrl(status.scannable ? payment?.uri : undefined)
  const complete = flow.state.kind === 'COMPLETE'
  const panel = useRef<HTMLDivElement>(null)

  // Dismissing is offered only while nothing can have been sent. Past that, the
  // modal is reporting on money and a stray Escape must not read as "never
  // mind" (docs/05 §55).
  const dismissible = !status.committed && !mayHaveBeenCharged(flow.state)

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && dismissible) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPositioner>
          <DialogPrimitive.Content
            ref={panel}
            className={cn(dialogPanelClass, 'relative max-w-sm gap-4 text-center focus:outline-none sm:p-7')}
            aria-describedby={undefined}
            // Focus the panel itself rather than the first control in it.
            // Radix would otherwise land on the close button, which puts a ring
            // around "dismiss" the instant a payment screen opens — the wrong
            // thing to draw the eye to. Focus still moves into the dialog, so
            // the keyboard and screen-reader contract is unchanged.
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
            <header className="space-y-1 px-6">
              <DialogPrimitive.Title className="text-h3 font-semibold text-ink">
                {headline(flow.state.kind, complete)}
              </DialogPrimitive.Title>
              <p className="text-small text-ink-muted">{passTitle}</p>
              {/*
                Putting the code away, and nothing more. It is absent exactly
                when dismissing would be a lie — once a transaction may exist,
                there is no "never mind" to offer.
              */}
              {dismissible ? (
                <DialogPrimitive.Close
                  className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink sm:size-9"
                  aria-label="Close"
                >
                  <X className="size-4" aria-hidden="true" />
                </DialogPrimitive.Close>
              ) : null}
            </header>

            {/*
              The square is the QR or the confirmation, and nothing else. While
              a payment is merely being verified there is no square at all — a
              240px box holding one spinner reads as a stalled screen, and the
              status line below says more than it ever could.
            */}
            {status.scannable && payment ? (
              <QrSquare qr={qr} />
            ) : complete ? (
              <SuccessSquare passId={flow.state.kind === 'COMPLETE' ? flow.state.passId : null} />
            ) : null}

            {/*
              The amount stays visible at every stage. `paymentRequest` is null
              once the intent is no longer payable, so the purchase's own
              snapshot carries it from there — still the server's figure, never
              a recomputed one.
            */}
            <p className="numeric font-display text-h2 font-semibold text-ink">
              {formatNim(request?.valueLuna ?? purchase.priceLuna)}
            </p>

            {/*
              The instruction, and the way out of it.

              The code is a payment request, so the scanner that reads it is the
              one inside Nimiq Pay: Pay → Scan. Whether that scanner accepts
              this exact payload has not been confirmed on a device (ADR-006
              G1), which is precisely why the opener sits directly underneath
              rather than in a footnote — a refused scan has to leave the
              customer somewhere, and "open this purchase in Nimiq Pay" reaches
              the same intent and settles identically.
            */}
            {status.scannable && payment ? (
              <div className="space-y-3 text-small">
                <p className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-muted p-3 text-left text-ink">
                  <ScanLine className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  <span>
                    <strong className="font-medium">Scan with Nimiq Pay.</strong> Open Nimiq Pay,
                    tap Pay, then Scan. The payment opens with the provider’s address and{' '}
                    {request?.valueNim ?? ''} NIM already filled in — check them, then confirm.
                    {' '}
                    <span className="text-ink-muted">
                      This page updates by itself once the payment is on the blockchain; there is
                      nothing to copy back.
                    </span>
                  </span>
                </p>
                {handoff ? (
                  <p className="text-ink-muted">
                    Code not accepted?{' '}
                    <a className="underline underline-offset-2" href={handoff.opener}>
                      Open this purchase in Nimiq Pay
                    </a>{' '}
                    and pay from there instead.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/*
              No verifiable payment request: say so plainly and offer the route
              that still works, rather than rendering a code we cannot vouch for.
            */}
            {status.scannable && !payment && handoff ? (
              <div className="space-y-3 text-small">
                <p className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning-soft p-3 text-left text-ink">
                  <Camera className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                  <span>
                    <strong className="font-medium">Pay on your phone.</strong> Open this purchase in
                    Nimiq Pay and approve the payment there.
                  </span>
                </p>
                <Button asChild block variant="secondary">
                  <a href={handoff.opener}>Open in Nimiq Pay</a>
                </Button>
              </div>
            ) : null}

            {/*
              Silent once the Pass exists: the heading and the panel above
              already say it, and a third "Payment confirmed" in one small
              window is noise — including for a screen reader, which would hear
              the live region repeat what the dialog is named.
            */}
            {complete ? null : <StatusLine status={status} />}

            {/*
              The wallet binding, stated before the scan rather than discovered
              after the payment. The backend requires the transaction's sender
              to be this wallet, and on this flow the phone is a different
              device that may well hold a different account.
            */}
            {request && status.scannable ? (
              <details className="group text-left text-small">
                <summary className="cursor-pointer list-none rounded-md py-1 text-center text-ink-muted marker:content-[''] hover:text-ink">
                  Payment details
                  <span className="ml-1 inline-block transition-transform group-open:rotate-90" aria-hidden="true">
                    &rsaquo;
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  <PaymentTerms purchase={purchase} request={request} />
                  {/*
                    Ownership, stated plainly, because the customer is about
                    to pay from a different device and may reasonably wonder.
                    It is no longer a warning: the code carries this
                    purchase's own reference, so a payment approved from
                    another account of the same wallet is still matched to
                    this intent — and the Pass goes to the signed-in wallet
                    either way, never to whichever account happened to pay.
                  */}
                  <p className="text-micro text-ink-subtle">
                    The Pass goes to the wallet shown above, whichever account you approve the
                    payment with.
                  </p>
                  {handoff ? (
                    <p className="break-all text-micro text-ink-subtle">
                      Or open on your phone: <code>{handoff.page}</code>
                    </p>
                  ) : null}
                </div>
              </details>
            ) : null}

            <Actions flow={flow} status={status} dismissible={dismissible} onClose={onClose} />
          </DialogPrimitive.Content>
        </DialogPositioner>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * What the dialog is called, at each stage.
 *
 * It is the accessible name of the whole thing, so it has to stay true: a
 * window still headed "Complete your payment" after the money has arrived tells
 * a screen-reader user to go and pay again.
 */
function headline(kind: string, complete: boolean): string {
  if (complete) return 'Payment confirmed'
  if (kind === 'INTENT_CREATED' || kind === 'CREATING_INTENT' || kind === 'IDLE') {
    return 'Complete your payment'
  }
  return 'Confirming your payment'
}

/** The code, or the space it will occupy. */
function QrSquare({ qr }: { qr: string | null }) {
  return (
    <div className="mx-auto flex size-[240px] items-center justify-center rounded-xl border border-line bg-white p-3">
      {qr ? (
        <img src={qr} width={216} height={216} alt="Nimiq payment request for this purchase" />
      ) : (
        <p role="status" className="text-small text-ink-subtle">
          Preparing QR…
        </p>
      )}
    </div>
  )
}

/** The end of the journey, in the same place the code used to be. */
function SuccessSquare({ passId }: { passId: string | null }) {
  return (
    <div className="mx-auto flex size-[240px] flex-col items-center justify-center gap-4 rounded-xl border border-success/20 bg-success-soft">
      <CheckCircle2 className="size-8 text-success" aria-hidden="true" />
      <p className="text-h3 font-semibold text-ink">Your Pass is ready.</p>
      {passId ? (
        <Button asChild size="sm">
          <Link to={`/passes/${passId}`}>View Pass</Link>
        </Button>
      ) : null}
    </div>
  )
}

const TONE_CLASSES: Record<string, string> = {
  waiting: 'text-ink-muted',
  progress: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

/**
 * The live status line.
 *
 * A polite live region: every transition here is progress the customer should
 * hear about without being yanked out of what they are reading. The states that
 * genuinely interrupt — uncertain, refused, compensation — are announced
 * assertively by `PaymentStateView` on the page behind this modal, and
 * duplicating that here would announce them twice.
 */
function StatusLine({ status }: { status: ReturnType<typeof checkoutStatus> }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn('flex items-center justify-center gap-2 text-small font-medium', TONE_CLASSES[status.tone])}
    >
      {status.tone === 'progress' || status.tone === 'waiting' ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : null}
      {status.label}
    </p>
  )
}

/**
 * The footer control — singular, almost always.
 *
 * Only ever one of three things: ask the backend to re-check while something
 * may be in flight, let the intent go while nothing was sent, or leave once the
 * Pass exists. There is deliberately no "I've paid" button: the customer saying
 * so is not evidence, and the backend's verdict arrives on its own.
 *
 * Simply putting the code away is the corner X instead, so that the one text
 * button in the footer always means something consequential.
 */
function Actions({
  flow,
  status,
  dismissible,
  onClose,
}: {
  flow: PurchaseFlow
  status: ReturnType<typeof checkoutStatus>
  dismissible: boolean
  onClose: () => void
}) {
  if (flow.state.kind === 'COMPLETE') {
    return (
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    )
  }

  if (status.committed) {
    return (
      <Button
        size="sm"
        variant="secondary"
        loading={flow.reconciling}
        onClick={() => void flow.reconcile()}
      >
        Check again
      </Button>
    )
  }

  if (dismissible && flow.mayCancel) {
    return (
      <Button
        size="sm"
        variant="ghost"
        loading={flow.cancelling}
        disabled={flow.cancelling}
        onClick={() => void flow.cancel()}
      >
        Cancel this payment
      </Button>
    )
  }

  return null
}

/**
 * Renders the locator as a data URL, and drops it the moment it stops being
 * scannable.
 *
 * The effect is cancelled on unmount and on every change of target, so a slow
 * render that resolves after the modal closed cannot set state on a dead
 * component or leave a stale code on screen.
 */
function useQrDataUrl(target: string | undefined): string | null {
  const [rendered, setRendered] = useState<{ target: string; dataUrl: string } | null>(null)

  useEffect(() => {
    if (!target) return
    let active = true
    void QRCode.toDataURL(target, { width: 432, margin: 1, errorCorrectionLevel: 'M' })
      .then((dataUrl) => {
        if (active) setRendered({ target, dataUrl })
      })
      .catch(() => {
        // Nothing to set: the caller renders "Preparing QR…" and the link in
        // the details below remains a complete way through.
      })
    return () => {
      active = false
    }
  }, [target])

  // Derived during render, and tied to the target it was made for. That pairing
  // is what guarantees a code for a previous intent — or for an intent that is
  // no longer payable — can never be left on screen.
  return rendered && rendered.target === target ? rendered.dataUrl : null
}

/**
 * The handoff for this purchase, or null if one cannot be built.
 *
 * `purchaseHandoff` throws on an id that is not a UUID or an origin it refuses
 * to build a link from. That is a programming error rather than a customer
 * situation, and it must not take the whole checkout down with it — the modal
 * renders its price, terms and live status either way.
 */
function safeHandoff(id: string): ReturnType<typeof purchaseHandoff> | null {
  try {
    return purchaseHandoff(id)
  } catch {
    return null
  }
}
