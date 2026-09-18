import { AlertTriangle, CalendarX2, CheckCircle2, HelpCircle, Loader2, ReceiptText, Store, Wallet, XCircle } from 'lucide-react'
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
  INSUFFICIENT_FUNDS: "This wallet doesn't have enough NIM for this pass.",
  // Neither transport could be reached. Naming one of them would be a guess,
  // and telling a desktop visitor to find a phone is the wrong guess.
  WALLET_UNAVAILABLE: "We couldn't reach a Nimiq wallet to complete the purchase.",
  POPUP_BLOCKED:
    'Your browser blocked the Nimiq wallet window. Allow pop-ups for this site, then try again. Nothing was sent.',
  NO_CONSENSUS: "Your wallet isn't synced with the Nimiq network yet. Nothing was sent.",
  REJECTED_BY_BACKEND: "The payment didn't match this purchase, so no pass was created.",
  PAYMENT_CONFLICT:
    "We couldn't match this payment to this purchase, so no pass was created. Don't send another one — we'll look into it.",
  INTENT_EXPIRED: 'This purchase expired before the payment arrived. Start again to get a fresh one.',
  NETWORK_BEFORE_SUBMIT: "We couldn't reach the network. Nothing was sent.",
  WALLET_BUSY: 'Another wallet request is still open. Finish it, then try again.',
  UNKNOWN: "Payment couldn't be completed. Your pass was not created.",
}

/**
 * The two things a customer can do while nothing has been sent: try the payment
 * again, or let the intent go.
 *
 * They travel together because they mean the same thing about the world — no
 * money has moved — and each is rendered only when the flow says it is safe.
 * Nothing here decides that: the flow computes both, from the same rule.
 */
function UnpaidActions({
  retry,
  retryLabel,
  cancel,
  cancelling,
}: {
  retry?: () => void
  retryLabel: string
  cancel?: () => void
  cancelling?: boolean
}) {
  if (!retry && !cancel) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {retry ? (
        <Button size="sm" variant="secondary" onClick={retry}>
          {retryLabel}
        </Button>
      ) : null}
      {cancel ? (
        <Button size="sm" variant="ghost" onClick={cancel} loading={cancelling} disabled={cancelling}>
          {cancelling ? 'Cancelling…' : "I don't want this anymore"}
        </Button>
      ) : null}
    </div>
  )
}

function describePaymentState(
  state: PaymentState,
  handlers: {
    onRetry?: () => void
    onReconcile?: () => void
    reconciling?: boolean
    onCancel?: () => void
    cancelling?: boolean
  } = {},
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
        // No expiry is rendered here on purpose: the intent's deadline and the
        // pass cutoff are the backend's arithmetic, and a countdown on this
        // side would be a second implementation of a money rule (§8).
        action: (
          <UnpaidActions
            retryLabel="Try again"
            cancel={handlers.onCancel}
            cancelling={handlers.cancelling}
          />
        ),
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
     *
     * Only reachable under `NIMIQ_CONFIRMATION_POLICY=finality`. The default
     * policy issues the pass on canonical inclusion and goes straight from
     * VERIFYING to CONFIRMED, so no customer sits here for a macro block
     * (ADR-021).
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

    /*
     * The quiet, permanent version of the good news.
     *
     * The loud version is the success dialog, which opens once when the
     * backend reports COMPLETE and is then remembered as shown. This panel is
     * what remains afterwards and on every later visit — so it states the
     * outcome rather than re-announcing it, and its wording is deliberately
     * different from the dialog's so the screen never says the same sentence
     * twice.
     */
    case 'COMPLETE':
      return {
        tone: 'success',
        icon: <CheckCircle2 aria-hidden="true" />,
        title: 'Pass added to My Passes',
        body: 'Your payment was verified on the Nimiq blockchain and this pass is yours.',
        action: (
          <Button asChild size="sm">
            <Link to={`/passes/${state.passId}`}>Open your pass</Link>
          </Button>
        ),
      }

    /*
     * Two different outcomes arrive here, and they owe the customer opposite
     * advice, so they must not share copy.
     *
     * The original is a verified payment with no pass: the NIM arrived, sits
     * with the provider, and paying again would be money lost. Everything that
     * branch says is constrained by what the backend actually guarantees — the
     * payment was verified, no pass was issued, do not pay again, and no
     * automated refund exists. "Refund on its way" and "we'll process this
     * automatically" would be inventions (§4, §7 of this milestone).
     *
     * The second is a reversed settlement: a pass issued on an inclusion that
     * never became canonical, so no NIM ever left the wallet (ADR-021). Telling
     * that customer their payment arrived and not to pay again would leave them
     * with neither a pass nor a way to get one.
     *
     * `doNotPayAgain` is the backend's own distinction between them, so it is
     * what this branches on rather than a guess from the reason string. A
     * missing flag reads as `true` (`types/payment.ts`), which keeps the
     * cautious wording the default.
     *
     * The raw `COMPENSATION_REQUIRED` enum never reaches the screen (§5).
     */
    case 'COMPENSATION_REQUIRED':
      return state.compensation?.doNotPayAgain === false
        ? {
            tone: 'warning',
            icon: <ReceiptText aria-hidden="true" />,
            title: 'This payment did not go through',
            body:
              'Your transaction did not stay on the Nimiq blockchain, so it was never completed and nothing was charged. The pass it created has been removed from your account.',
            reassurance: "You were not charged. You can buy this pass again when you're ready.",
            detail: state.purchase.transactionHash
              ? `Reference ${shortHash(state.purchase.transactionHash)}`
              : undefined,
            action: (
              <Button asChild size="sm" variant="secondary">
                <Link to={`/pass/${state.purchase.passId}`}>Back to the pass</Link>
              </Button>
            ),
          }
        : {
            tone: 'warning',
            icon: <ReceiptText aria-hidden="true" />,
            title: 'Payment received, but your pass could not be issued',
            body:
              'Your payment arrived and we have a record of it. This pass reached its end date before the pass could be created, so there is no pass on your account.',
            reassurance:
              "Do not pay again. We've logged this for review, and you'll be contacted about putting it right.",
            // A verified receipt is the one durable thing the customer holds
            // here, so the detail that identifies it is worth showing.
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
     * Refused before any money moved: the pass is too close to its fixed
     * expiration for a purchase to settle safely.
     *
     * The 35-minute cutoff is the backend's arithmetic and stays there. This
     * branch only reports the decision it was given (§8).
     */
    /**
     * This account created the pass. Not a payment problem — there was never
     * going to be a payment — so the copy says what is true and points at the
     * thing they can actually do with their own pass.
     */
    case 'SELF_PURCHASE':
      return {
        tone: 'neutral',
        icon: <Store aria-hidden="true" />,
        title: 'This is your pass',
        body: 'You created this pass, so you cannot buy it yourself. Share the link with a customer instead.',
        reassurance: 'You have not been charged.',
        action: (
          <Button asChild size="sm" variant="secondary">
            <Link to="/my-store">Open My Store</Link>
          </Button>
        ),
      }

    /**
     * They already have one of these, and it still has sessions on it.
     *
     * Not a payment problem either, and not something to retry — so the copy
     * says what they hold rather than what went wrong, and the action opens
     * the pass instead of a second checkout. `Buy Again` is what happens after
     * that pass is finished (docs/01-PRODUCT.md §56).
     */
    case 'ALREADY_OWNED':
      return {
        tone: 'neutral',
        icon: <Wallet aria-hidden="true" />,
        title: 'You already have this pass',
        body:
          'You still have sessions left on the pass you bought. Use those first — you can buy this pass again once it is finished.',
        reassurance: 'You have not been charged.',
        action: (
          <Button asChild size="sm" variant="secondary">
            <Link to="/passes">Go to My Passes</Link>
          </Button>
        ),
      }

    /**
     * Their previous attempt at this pass has not finished settling.
     *
     * The only refusal on this screen that does *not* say "you have not been
     * charged", because it cannot: the attempt this is protecting may well
     * have been paid, and that is the whole reason a second one is refused.
     * The copy asks them to wait and says explicitly not to pay again (§55).
     */
    case 'PURCHASE_IN_SETTLEMENT':
      return {
        tone: 'neutral',
        icon: <Loader2 aria-hidden="true" />,
        title: 'Still checking your last payment',
        body:
          "You started a payment for this pass a moment ago and we're still looking for it on the network. If you paid, your pass will appear on its own.",
        reassurance: 'Do not pay again. Check My Passes in a few minutes.',
        action: (
          <Button asChild size="sm" variant="secondary">
            <Link to="/passes">Go to My Passes</Link>
          </Button>
        ),
      }

    case 'PURCHASE_CUTOFF':
      return {
        tone: 'neutral',
        icon: <CalendarX2 aria-hidden="true" />,
        title: 'Too late to buy this pass',
        body:
          "This pass is too close to its end date to buy safely — there wouldn't be enough time to confirm the payment before it expires.",
        reassurance: 'You have not been charged.',
        action: (
          <Button asChild size="sm" variant="secondary">
            <Link to="/discover">Find another pass</Link>
          </Button>
        ),
      }

    case 'CANCELLED':
      return {
        tone: 'neutral',
        icon: <XCircle aria-hidden="true" />,
        title: 'Payment cancelled',
        body: 'You were not charged.',
        action: (
          <UnpaidActions
            retry={handlers.onRetry}
            retryLabel="Try again"
            cancel={handlers.onCancel}
            cancelling={handlers.cancelling}
          />
        ),
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
  onCancel,
  cancelling,
  className,
}: {
  state: PaymentState
  onRetry?: () => void
  /** Asks the backend to re-check. Never starts a payment. */
  onReconcile?: () => void
  reconciling?: boolean
  /** Abandons an unpaid intent. Never offered once anything may have been sent. */
  onCancel?: () => void
  cancelling?: boolean
  className?: string
}) {
  // A retry may only be offered where a second payment is safe (§55).
  const retry = onRetry && mayRetryPayment(state) ? onRetry : undefined
  const presentation = describePaymentState(state, {
    onRetry: retry,
    onReconcile,
    reconciling,
    onCancel,
    cancelling,
  })
  if (!presentation) return null

  const critical = CRITICAL_KINDS.has(state.kind)

  return (
    <div
      // `alert` for the states that need interrupting, `status` for progress.
      // Both are live regions, so a transition announces itself without moving
      // focus — which would yank the user out of whatever they were reading.
      role={critical ? 'alert' : 'status'}
      aria-live={critical ? 'assertive' : 'polite'}
      className={cn(
        'flex gap-3 rounded-xl border p-4',
        'transition-colors duration-[--nimpass-duration-base]',
        TONE_CLASSES[presentation.tone],
        className,
      )}
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
      {/*
        Keyed on the state so each new message fades in rather than swapping
        mid-sentence. The live region itself is the element *above* this one and
        is never replaced — a screen reader has to be watching a region that
        already exists for a change inside it to be announced.
      */}
      <div key={state.kind} className="animate-fade-in min-w-0 space-y-1.5">
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
