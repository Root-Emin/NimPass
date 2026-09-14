import { AlertTriangle, CalendarX2, CheckCircle2, HelpCircle, Loader2, ReceiptText, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PaymentState } from '@/types/payment'
import { mayRetryPayment } from '@/types/payment'


/**
 * Renders the payment state machine.
 *
 * Copy is taken from docs/03-DESIGN-SYSTEM.md §47 and docs/05-NIMIQ-PAY-INTEGRATION.md
 * §54-§62. Three rules are load-bearing:
 *
 *   - Cancellation says "you were not charged" and is not dressed as an error.
 *   - Uncertainty never says "failed", and never offers a retry, because a
 *     false failure is how users end up paying twice (§62).
 *   - Anything at or past submission tells the user not to pay again (§55).
 */
type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger'

interface Presentation {
  tone: Tone
  icon: ReactNode
  title: string
  body: string
  /** Extra emphasis for the "do not pay again" guarantee. */
  reassurance?: string
  /** Quiet supporting detail, e.g. a receipt reference. */
  detail?: string
  action?: ReactNode
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-line bg-surface-muted',
  progress: 'border-info/20 bg-info-soft',
  success: 'border-success/20 bg-success-soft',
  warning: 'border-warning/25 bg-warning-soft',
  danger: 'border-danger/20 bg-danger-soft',
}

const ICON_CLASSES: Record<Tone, string> = {
  neutral: 'text-ink-subtle',
  progress: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

const FAILURE_COPY: Record<string, string> = {
  INSUFFICIENT_FUNDS: "This wallet doesn't have enough NIM for this package.",
  WALLET_UNAVAILABLE: 'Open Nimpass in Nimiq Pay to complete the purchase.',
  REJECTED_BY_BACKEND: "The payment didn't match this purchase, so no pass was created.",
  PAYMENT_CONFLICT:
    "We couldn't match this payment to this purchase, so no pass was created. Don't send another one — we'll look into it.",
  INTENT_EXPIRED: 'This purchase expired before the payment arrived. Start again to get a fresh one.',
  NETWORK_BEFORE_SUBMIT: "We couldn't reach the network. Nothing was sent.",
  WALLET_BUSY: 'Another Nimiq Pay request is still open. Finish it, then try again.',
  UNKNOWN: "Payment couldn't be completed. Your pass was not created.",
}

function describePaymentState(
  state: PaymentState,
  handlers: { onRetry?: () => void; onReconcile?: () => void; reconciling?: boolean } = {},
): Presentation | null {
  const spinner = <Loader2 className="animate-spin" aria-hidden="true" />

  switch (state.kind) {
    case 'IDLE':
      return null

    case 'CREATING_INTENT':
      return { tone: 'progress', icon: spinner, title: 'Preparing payment…', body: 'Setting up your purchase.' }

    case 'INTENT_CREATED':
      return {
        tone: 'neutral',
        icon: <CheckCircle2 aria-hidden="true" />,
        title: 'Ready to pay',
        body: 'Confirm the payment in Nimiq Pay to get your pass.',
      }

    case 'AWAITING_WALLET':
      return {
        tone: 'progress',
        icon: spinner,
        title: 'Waiting for Nimiq Pay…',
        body: 'Approve the payment in Nimiq Pay, or dismiss it to cancel.',
      }

    case 'TRANSACTION_SUBMITTED':
      return {
        tone: 'progress',
        icon: spinner,
        title: 'Confirming your payment…',
        body: 'Your payment was sent. We are checking it now.',
        reassurance: 'Do not send another payment.',
      }

    case 'VERIFYING':
      return {
        tone: 'progress',
        icon: spinner,
        title: 'Confirming your payment…',
        body: 'This usually takes a few seconds.',
        reassurance: 'Do not send another payment.',
      }

    /*
     * Awaiting finality. Emphatically not a failure (§16): the transaction has
     * been found on chain and is waiting for the macro block that makes it
     * permanent. The copy says what is actually happening — received, being
     * finalised — rather than implying doubt, and the only control offered is a
     * re-check, never a payment.
     */
    case 'PENDING':
      return {
        tone: 'progress',
        icon: spinner,
        title: 'Finalising your payment…',
        body: 'Your transaction was received and is still being finalised. Your pass appears as soon as it is.',
        reassurance: 'Do not send another payment.',
        action: checkAgain(handlers),
      }

    case 'VERIFICATION_DELAYED':
      return {
        tone: 'warning',
        icon: <AlertTriangle aria-hidden="true" />,
        title: 'Still confirming your payment…',
        body: 'This is taking longer than usual. We will keep checking.',
        reassurance: 'Do not send another payment.',
        action: checkAgain(handlers),
      }

    case 'CONFIRMED':
    case 'PASS_CREATING':
      return {
        tone: 'success',
        icon: spinner,
        title: 'Payment received',
        body: "We're preparing your pass.",
        reassurance: 'You do not need to pay again.',
      }

    case 'COMPLETE':
      return {
        tone: 'success',
        icon: <CheckCircle2 aria-hidden="true" />,
        title: 'Payment successful',
        body: 'Your pass is ready.',
        action: (
          <Button asChild size="sm">
            <Link to={`/passes/${state.passId}`}>View pass</Link>
          </Button>
        ),
      }

    /*
     * The one state where the payment worked and the pass did not exist.
     *
     * Everything here is constrained by what the backend actually guarantees.
     * It says the payment was verified and finalised, that no pass was issued,
     * that the customer must not pay again, and — explicitly — that no
     * automated refund exists. So the copy says those four things and stops.
     * "Refund on its way", "funds returned" and "we'll process this
     * automatically" would all be inventions (§4, §7 of this milestone).
     *
     * The raw `COMPENSATION_REQUIRED` enum never reaches the screen (§5).
     */
    case 'COMPENSATION_REQUIRED':
      return {
        tone: 'warning',
        icon: <ReceiptText aria-hidden="true" />,
        title: 'Payment received, but your pass could not be issued',
        body:
          'Your payment arrived and we have a record of it. This package reached its end date before the pass could be created, so there is no pass on your account.',
        reassurance:
          "Do not pay again. We've logged this for review, and you'll be contacted about putting it right.",
        // A verified receipt is the one durable thing the customer holds here,
        // so the detail that identifies it is worth showing.
        detail: state.purchase.transactionHash
          ? `Reference ${shortHash(state.purchase.transactionHash)}`
          : undefined,
        action: (
          <Button asChild size="sm" variant="secondary">
            <Link to="/passes">Go to My Passes</Link>
          </Button>
        ),
      }

    /*
     * Refused before any money moved: the package is too close to its fixed
     * expiration for a purchase to settle safely.
     *
     * The 35-minute cutoff is the backend's arithmetic and stays there. This
     * branch only reports the decision it was given (§8).
     */
    case 'PURCHASE_CUTOFF':
      return {
        tone: 'neutral',
        icon: <CalendarX2 aria-hidden="true" />,
        title: 'Too late to buy this package',
        body:
          "This package is too close to its end date to buy safely — there wouldn't be enough time to confirm the payment before it expires.",
        reassurance: 'You have not been charged.',
        action: (
          <Button asChild size="sm" variant="secondary">
            <Link to="/discover">Find another package</Link>
          </Button>
        ),
      }

    case 'CANCELLED':
      return {
        tone: 'neutral',
        icon: <XCircle aria-hidden="true" />,
        title: 'Payment cancelled',
        body: 'You were not charged.',
        action: handlers.onRetry ? (
          <Button size="sm" variant="secondary" onClick={handlers.onRetry}>
            Try again
          </Button>
        ) : undefined,
      }

    case 'FAILED':
      return {
        tone: 'danger',
        icon: <XCircle aria-hidden="true" />,
        title: "Payment couldn't be completed",
        body: FAILURE_COPY[state.reason] ?? FAILURE_COPY.UNKNOWN,
        reassurance: 'Your pass was not created.',
        action: handlers.onRetry ? (
          <Button size="sm" variant="secondary" onClick={handlers.onRetry}>
            Try again
          </Button>
        ) : undefined,
      }

    case 'UNCERTAIN':
      return {
        tone: 'warning',
        icon: <HelpCircle aria-hidden="true" />,
        title: 'Checking your payment…',
        body: "We can't confirm the outcome yet. We're still looking, and this page updates on its own.",
        reassurance: 'Do not send another payment.',
        action: checkAgain(handlers),
      }
  }
}

/**
 * States a screen reader should be interrupted for.
 *
 * Everything else is progress, and polite announcements are right for progress.
 * These three end the flow in a way the customer has to act on — and one of
 * them, compensation, is the state where doing nothing looks identical to doing
 * the wrong thing (§45).
 */
const CRITICAL_KINDS: ReadonlySet<PaymentState['kind']> = new Set([
  'COMPENSATION_REQUIRED',
  'UNCERTAIN',
  'FAILED',
])

export function PaymentStateView({
  state,
  onRetry,
  onReconcile,
  reconciling,
  className,
}: {
  state: PaymentState
  onRetry?: () => void
  /** Asks the backend to re-check. Never starts a payment. */
  onReconcile?: () => void
  reconciling?: boolean
  className?: string
}) {
  // A retry may only be offered where a second payment is safe (§55).
  const retry = onRetry && mayRetryPayment(state) ? onRetry : undefined
  const presentation = describePaymentState(state, { onRetry: retry, onReconcile, reconciling })
  if (!presentation) return null

  const critical = CRITICAL_KINDS.has(state.kind)

  return (
    <div
      // `alert` for the states that need interrupting, `status` for progress.
      // Both are live regions, so a transition announces itself without moving
      // focus — which would yank the user out of whatever they were reading.
      role={critical ? 'alert' : 'status'}
      aria-live={critical ? 'assertive' : 'polite'}
      className={cn('flex gap-3 rounded-md border p-4', TONE_CLASSES[presentation.tone], className)}
    >
      <span
        className={cn('mt-0.5 shrink-0 [&_svg]:size-4', ICON_CLASSES[presentation.tone])}
        // The icon is decoration: tone and glyph both carry meaning visually,
        // and neither is available to a screen reader or to someone who cannot
        // separate the warning colour from the neutral one. The title and body
        // carry the whole message on their own (§45).
      >
        {presentation.icon}
      </span>
      <div className="min-w-0 space-y-1.5">
        <p className="font-medium text-ink">{presentation.title}</p>
        <p className="text-body text-ink-muted">{presentation.body}</p>
        {presentation.reassurance ? (
          <p className="text-small font-medium text-ink">{presentation.reassurance}</p>
        ) : null}
        {presentation.detail ? (
          <p className="font-mono text-micro text-ink-subtle">{presentation.detail}</p>
        ) : null}
        {presentation.action ? <div className="pt-1">{presentation.action}</div> : null}
      </div>
    </div>
  )
}

/**
 * "Check again" — the only control offered while a payment may be in flight.
 *
 * It reconciles; it cannot pay. That distinction is the point: someone staring
 * at a long verification wants to *do* something, and this gives them an action
 * that is safe to take twenty times rather than leaving the urge to press the
 * one button that would charge them again (§16, §17, §20).
 */
function checkAgain(handlers: { onReconcile?: () => void; reconciling?: boolean }): ReactNode {
  if (!handlers.onReconcile) return undefined
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={handlers.reconciling}
      onClick={handlers.onReconcile}
    >
      Check again
    </Button>
  )
}

/** First and last six characters of a transaction hash — enough to match a receipt. */
function shortHash(hash: string): string {
  return hash.length <= 16 ? hash : `${hash.slice(0, 6)}…${hash.slice(-6)}`
}
