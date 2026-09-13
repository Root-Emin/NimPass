import { CheckCircle2, Clock, PenLine, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'

import { RedemptionCode } from '@/components/pass/redemption-code'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { SessionRedemption } from '@/hooks/use-redemption'
import { formatSessions } from '@/lib/format'

/**
 * The customer's "use a session" surface (docs/03-DESIGN-SYSTEM.md §55-§58).
 *
 * It walks the whole journey the brief asks for — challenge, code, countdown,
 * expiry, awaiting provider, resolved result — and the honesty of each step is
 * the design:
 *
 *  - Presenting a code is not using a session, and the copy says so
 *    (docs/02-USER-FLOWS.md §48).
 *  - Expiry reports that *no* session was used, because none was
 *    (docs/09-SECURITY.md §48).
 *  - Success appears only once the backend reports a smaller remaining count.
 *    There is no local decrement and no optimistic "done"
 *    (docs/01-PRODUCT.md §49, docs/08-ARCHITECTURE.md §49).
 */
export function RedemptionSheet({ redemption }: { redemption: SessionRedemption }) {
  const { state, begin, authorize, dismiss } = redemption
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

  function describe(): {
    title: string
    description: ReactNode
    body: ReactNode
    actions?: ReactNode
  } {
    switch (state.kind) {
      case 'IDLE':
        return { title: '', description: null, body: null }

      case 'REQUESTING':
        return {
          title: 'Getting your session code…',
          description: 'This does not use a session yet.',
          body: <Waiting label="Just a moment…" />,
        }

      case 'PRESENTED': {
        const needsSignature = Boolean(state.challenge.signingMessage)
        return {
          title: 'Show this to your provider',
          description: 'Your provider scans or types this code to confirm the session.',
          body: (
            <div className="space-y-4">
              {/* `key` remounts the code on a new challenge so the QR and the
                  countdown can never belong to a previous one. */}
              <RedemptionCode key={state.challenge.reference} challenge={state.challenge} />

              {needsSignature ? (
                <p className="flex gap-2.5 rounded-md bg-surface-muted p-3 text-small text-ink-muted">
                  <PenLine className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                  This pass asks you to approve the session in Nimiq Pay. It is a signature, not
                  a payment — no NIM leaves your wallet.
                </p>
              ) : null}

              <p className="text-center text-micro text-ink-subtle">
                Nothing is used until your provider confirms it. Your count
                updates here automatically.
              </p>
            </div>
          ),
          actions: needsSignature ? (
            <Button size="sm" onClick={() => void authorize()}>
              <ShieldCheck aria-hidden="true" />
              Approve in Nimiq Pay
            </Button>
          ) : undefined,
        }
      }

      case 'AWAITING_SIGNATURE':
        return {
          title: 'Approve the session',
          description: 'Nimiq Pay is asking you to sign a short message.',
          body: (
            <>
              <Waiting label="Waiting for your approval…" />
              <p className="rounded-md bg-surface-muted p-3 text-small text-ink-muted">
                This is a signature, not a payment. No NIM leaves your wallet.
              </p>
            </>
          ),
        }

      case 'AUTHORIZING':
        return {
          title: 'Checking your approval…',
          description: 'Nimpass is verifying your signature.',
          body: <Waiting label="Almost there…" />,
        }

      case 'EXPIRED':
        return {
          title: 'This code expired',
          // The single most important sentence on this screen.
          description: 'No session was used.',
          body: (
            <p className="flex gap-2.5 text-body text-ink-muted">
              <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              Codes are short-lived on purpose, so a screenshot is never a way to spend a
              session. Generate a new one when your provider is ready.
            </p>
          ),
          actions: (
            <>
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Close
              </Button>
              <Button size="sm" onClick={() => void begin()}>
                Generate a new code
              </Button>
            </>
          ),
        }

      case 'RESOLVED':
        return {
          title: 'Session used',
          description: `${formatSessions(state.remaining)} remaining.`,
          body: (
            <p className="flex gap-2.5 text-body text-ink-muted">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              {state.remaining === 0
                ? "That was the last session on this pass. It's now complete."
                : 'Your provider confirmed the session.'}
            </p>
          ),
          actions: (
            <Button size="sm" onClick={dismiss}>
              Done
            </Button>
          ),
        }

      case 'FAILED':
        return {
          title: "We couldn't start this session",
          description: state.message,
          body: (
            <p className="text-body text-ink-muted">
              No session was used. You can try again.
            </p>
          ),
          actions: (
            <>
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Close
              </Button>
              <Button size="sm" onClick={() => void begin()}>
                Try again
              </Button>
            </>
          ),
        }
    }
  }
}

function Waiting({ label }: { label: string }) {
  return (
    <p
      className="flex items-center gap-2.5 text-body text-ink-muted"
      role="status"
      aria-live="polite"
    >
      <span className="size-4 animate-pulse rounded-full bg-accent-soft" aria-hidden="true" />
      {label}
    </p>
  )
}
