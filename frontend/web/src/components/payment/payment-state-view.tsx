import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, XCircle } from 'lucide-react'
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
  INTENT_EXPIRED: 'This purchase expired before the payment arrived. Start again to get a fresh one.',
  NETWORK_BEFORE_SUBMIT: "We couldn't reach the network. Nothing was sent.",
  WALLET_BUSY: 'Another Nimiq Pay request is still open. Finish it, then try again.',
  UNKNOWN: "Payment couldn't be completed. Your pass was not created.",
}

function describePaymentState(
  state: PaymentState,
  handlers: { onRetry?: () => void } = {},
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

    case 'PENDING':
      return {
        tone: 'progress',
        icon: spinner,
        title: 'Confirming your payment…',
        body: 'Your payment is on its way and is waiting to be confirmed.',
        reassurance: 'Do not send another payment.',
      }

    case 'VERIFICATION_DELAYED':
      return {
        tone: 'warning',
        icon: <AlertTriangle aria-hidden="true" />,
        title: 'Still confirming your payment…',
        body: 'This is taking longer than usual. We will keep checking.',
        reassurance: 'Do not send another payment.',
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
        body: "We couldn't confirm whether your payment went through yet.",
        reassurance: 'Do not send another payment yet. We will update this page.',
      }
  }
}

export function PaymentStateView({
  state,
  onRetry,
  className,
}: {
  state: PaymentState
  onRetry?: () => void
  className?: string
}) {
  // A retry may only be offered where a second payment is safe (§55).
  const retry = onRetry && mayRetryPayment(state) ? onRetry : undefined
  const presentation = describePaymentState(state, { onRetry: retry })
  if (!presentation) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex gap-3 rounded-md border p-4', TONE_CLASSES[presentation.tone], className)}
    >
      <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4', ICON_CLASSES[presentation.tone])}>
        {presentation.icon}
      </span>
      <div className="min-w-0 space-y-1.5">
        <p className="font-medium text-ink">{presentation.title}</p>
        <p className="text-body text-ink-muted">{presentation.body}</p>
        {presentation.reassurance ? (
          <p className="text-small font-medium text-ink">{presentation.reassurance}</p>
        ) : null}
        {presentation.action ? <div className="pt-1">{presentation.action}</div> : null}
      </div>
    </div>
  )
}
