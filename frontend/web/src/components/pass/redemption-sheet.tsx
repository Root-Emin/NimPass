import { CheckCircle2, Clock, Loader2, PenLine, ShieldCheck, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { RedemptionCode } from '@/components/pass/redemption-code'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { SessionRedemption } from '@/hooks/use-redemption'
import { formatSessions } from '@/lib/format'

/**
 * The customer's "use a session" surface (docs/03-DESIGN-SYSTEM.md §55-§58).
 *
 * It walks the real ceremony — challenge, native signature, authorised code,
 * countdown, provider confirmation — and the honesty of each step is the whole
 * design:
 *
 *  - Signing authorises a session; it is not a payment, and the copy says so
 *    before the native dialog opens (§7).
 *  - Dismissing that dialog is a cancellation, not a failure, and no usable
 *    code is ever minted from it (§8).
 *  - Showing a code is not using a session (docs/02-USER-FLOWS.md §48).
 *  - Expiry reports that *no* session was used, because none was
 *    (docs/09-SECURITY.md §48).
 *  - Success appears only when the backend says the challenge was consumed.
 *    There is no local decrement and no optimistic "done"
 *    (docs/01-PRODUCT.md §49, docs/08-ARCHITECTURE.md §49).
 */
export function RedemptionSheet({
  redemption,
  passId,
}: {
  redemption: SessionRedemption
  passId?: string
}) {
  const { state, begin, proceed, restoreReference, dismiss } = redemption
  const open = state.kind !== 'IDLE'
  const step = describe()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
    >
      {open ? (
        <DialogContent title={step.title} description={step.description}>
          {step.body}
          {step.actions ? (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {step.actions}
            </div>
          ) : null}
        </DialogContent>
      ) : null}
    </Dialog>
  )

  function close(label = 'Close') {
    return (
      <Button variant="secondary" onClick={dismiss}>
        {label}
      </Button>
    )
  }

  function tryAgain(label = 'Start again') {
    return <Button onClick={() => void begin()}>{label}</Button>
  }

  function describe(): {
    title: string
    description: ReactNode
    body: ReactNode
    actions?: ReactNode
  } {
    switch (state.kind) {
      case 'IDLE':
        return { title: '', description: null, body: null }

      case 'CREATING_CHALLENGE':
        return {
          title: 'Getting your session code…',
          description: 'This does not use a session yet.',
          body: <Waiting label="Just a moment…" />,
        }

      /*
       * The one screen that exists purely to make the native dialog
       * understandable. Nimiq Pay is about to ask for a signature, and a
       * customer who has just bought something with NIM will reasonably assume
       * any wallet prompt is a payment. It is not, and saying so here — before
       * the sheet opens — is the difference between informed approval and a
       * dismissed dialog (§7).
       *
       * The canonical message itself is deliberately not dumped on screen. It
       * is machine-readable ceremony, not customer-facing text, and the actual
       * cryptographic approval belongs to Nimiq Pay's own native UI.
       */
      case 'AWAITING_SIGNATURE':
        return {
          title: 'Approve this session',
          description: 'Your wallet will ask you to confirm. This is not a payment.',
          body: (
            <div className="space-y-4">
              <Reassurance
                icon={<ShieldCheck aria-hidden="true" />}
                title="No NIM is sent"
                body="You are approving the use of one session from this pass. Nothing leaves your wallet."
              />
              <Reassurance
                icon={<PenLine aria-hidden="true" />}
                title="Your provider still has to confirm"
                body="After you approve, you'll get a code to show them. The session is only used once they confirm it."
              />
            </div>
          ),
          actions: (
            <>
              {close('Not now')}
              <Button onClick={() => void proceed()}>Continue</Button>
            </>
          ),
        }

      case 'SIGNING':
        return {
          title: 'Waiting for your wallet…',
          description: 'Approve the request in Nimiq Pay, or dismiss it to cancel.',
          body: <Waiting label="Nimiq Pay is open…" />,
        }

      case 'AUTHORIZING':
        return {
          title: 'Checking your approval…',
          description: 'Almost there.',
          body: <Waiting label="Just a moment…" />,
        }

      case 'QR_READY':
        return {
          title: 'Show this to your provider',
          description: 'Showing this code does not use a session yet.',
          body: (
            <div className="space-y-5">
              {/*
                Keyed on the reference so a rotation unmounts the old QR
                entirely rather than re-rendering a stale image over a new
                code (§15).
              */}
              <RedemptionCode
                key={state.reference}
                reference={state.reference}
                expiresAt={state.challenge.expiresAt}
              />
              <p className="text-center text-small text-ink-muted">
                Waiting for your provider to confirm…
              </p>
            </div>
          ),
          actions: close(),
        }

      /*
       * Authorised, but this browser has no reference — the usual cause is a
       * reload, because reading a challenge back never returns one.
       *
       * Nothing is fabricated here. Re-posting to the create endpoint rotates
       * the reference server-side and returns a fresh one, without a second
       * signature, because this challenge is already authorised (§14).
       */
      case 'AUTHORIZED_NO_REFERENCE':
        return {
          title: 'Your session is still approved',
          description: 'We just need to issue a new code for it.',
          body: (
            <p className="text-body text-ink-muted">
              Codes are only shown once, so this one isn't on this device any more. Getting a new
              one won't use a session, and won't ask you to approve again.
            </p>
          ),
          actions: (
            <>
              {close()}
              <Button onClick={() => void restoreReference()}>Show a new code</Button>
            </>
          ),
        }

      case 'CONSUMED':
        return {
          title: state.completed ? 'Session used — pass complete' : 'Session used',
          description: state.completed
            ? 'That was the last session on this pass.'
            : `${formatSessions(state.remainingSessions)} left on this pass.`,
          body: (
            <Outcome
              tone="success"
              icon={<CheckCircle2 aria-hidden="true" />}
              title="Your provider confirmed it"
              body={
                state.completed
                  ? "You've used every session on this pass."
                  : `You have ${formatSessions(state.remainingSessions)} remaining.`
              }
            />
          ),
          actions: close('Done'),
        }

      case 'EXPIRED':
        return {
          title: 'That code expired',
          description: 'No session was used.',
          body: (
            <Outcome
              tone="warning"
              icon={<Clock aria-hidden="true" />}
              title="Nothing was used"
              body="Codes last five minutes. You can get a new one whenever you're ready."
            />
          ),
          actions: (
            <>
              {close()}
              {tryAgain('Get a new code')}
            </>
          ),
        }

      /*
       * The pass changed since this challenge was made — another session was
       * redeemed in between. The old attempt cannot be reused, and the frontend
       * must not try (§27).
       */
      case 'STALE':
        return {
          title: 'This code is out of date',
          description: 'No session was used by it.',
          body: (
            <Outcome
              tone="warning"
              icon={<Clock aria-hidden="true" />}
              title="Something changed on this pass"
              body="A session was used since this code was made, so it no longer applies. Start again to get a current one."
            />
          ),
          actions: (
            <>
              {close()}
              {tryAgain()}
            </>
          ),
        }

      case 'ALREADY_CONSUMED':
        return {
          title: 'This session was already used',
          description: 'Nothing was used twice.',
          body: (
            <Outcome
              tone="neutral"
              icon={<CheckCircle2 aria-hidden="true" />}
              title="Already redeemed"
              body="Your provider has already confirmed this one. Your remaining sessions are up to date."
            />
          ),
          actions: close('Done'),
        }

      case 'PASS_COMPLETED':
        return {
          title: 'No sessions left',
          description: "You've used every session on this pass.",
          body: (
            <Outcome
              tone="neutral"
              icon={<CheckCircle2 aria-hidden="true" />}
              title="This pass is complete"
              body="Nothing more to use here."
            />
          ),
          actions: (
            <>
              {close()}
              {passId ? (
                <Button asChild>
                  <Link to="/discover">Find another package</Link>
                </Button>
              ) : null}
            </>
          ),
        }

      case 'PASS_EXPIRED':
        return {
          title: 'This pass has expired',
          description: 'Its usable period has ended.',
          body: (
            <Outcome
              tone="warning"
              icon={<Clock aria-hidden="true" />}
              title="Outside its dates"
              body="This pass can no longer be used, and no session was taken."
            />
          ),
          actions: close(),
        }

      /*
       * The wallet dialog was dismissed. Explicitly not an error: no reference
       * was minted, so there is nothing a provider could have redeemed (§8).
       */
      case 'CANCELLED':
        return {
          title: 'Nothing was used',
          description: 'You cancelled the approval.',
          body: (
            <Outcome
              tone="neutral"
              icon={<XCircle aria-hidden="true" />}
              title="No session used"
              body="No code was created, so nothing can be redeemed. You can start again whenever you like."
            />
          ),
          actions: (
            <>
              {close()}
              {tryAgain()}
            </>
          ),
        }

      case 'INVALID_SIGNATURE':
        return {
          title: "We couldn't verify that approval",
          description: 'No session was used.',
          body: (
            <Outcome
              tone="warning"
              icon={<XCircle aria-hidden="true" />}
              title="The approval didn't match"
              body="Nothing was used. Starting again will create a fresh request for you to approve."
            />
          ),
          actions: (
            <>
              {close()}
              {tryAgain()}
            </>
          ),
        }

      case 'AUTH_REQUIRED':
        return {
          title: 'Sign in again',
          description: 'Your session has ended.',
          body: (
            <Outcome
              tone="warning"
              icon={<ShieldCheck aria-hidden="true" />}
              title="You've been signed out"
              body="Sign in with your wallet to use a session. Nothing was used."
            />
          ),
          actions: close(),
        }

      case 'UNCERTAIN':
        return {
          title: "We couldn't complete that",
          description: 'No session was used.',
          body: (
            <Outcome
              tone="warning"
              icon={<XCircle aria-hidden="true" />}
              title="Something went wrong"
              body={state.message}
            />
          ),
          actions: (
            <>
              {close()}
              {tryAgain()}
            </>
          ),
        }
    }
  }
}

function Waiting({ label }: { label: string }) {
  return (
    <div
      className="flex flex-col items-center gap-3 py-8 text-ink-subtle"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <p className="text-small">{label}</p>
    </div>
  )
}

function Reassurance({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-accent [&_svg]:size-4">{icon}</span>
      <div className="space-y-0.5">
        <p className="text-body font-medium text-ink">{title}</p>
        <p className="text-small text-ink-muted">{body}</p>
      </div>
    </div>
  )
}

const OUTCOME_TONES = {
  success: 'text-success',
  warning: 'text-warning',
  neutral: 'text-ink-subtle',
} as const

function Outcome({
  tone,
  icon,
  title,
  body,
}: {
  tone: keyof typeof OUTCOME_TONES
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    // `status`, not `alert`: the dialog already took focus, so an assertive
    // region would interrupt the title the screen reader is reading (§43).
    <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
      <span className={`${OUTCOME_TONES[tone]} [&_svg]:size-7`}>{icon}</span>
      <p className="text-body-lg font-medium text-ink">{title}</p>
      <p className="max-w-sm text-body text-ink-muted">{body}</p>
    </div>
  )
}
