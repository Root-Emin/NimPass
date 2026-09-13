import { Loader2, PenLine, ShieldCheck, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useSession } from '@/hooks/use-session'
import { networkLabel } from '@/lib/nimiq'
import type { AuthFlowState } from '@/types/auth'

/**
 * Explains the sign-in before it happens, then narrates it.
 *
 * Two native Nimiq Pay dialogs appear during this flow — one to reveal an
 * account, one to sign — and both follow from a single deliberate user action.
 * They are never open at once (docs/04-NIMIQ-MINI-APPS.md §24, §56).
 *
 * The copy is explicit that signing is not a payment: docs/09-SECURITY.md §14
 * calls for a human-readable, purposeful message, and a user who cannot tell a
 * signature from a transfer cannot give meaningful consent.
 */
export function SignInDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { flow, signIn, resetFlow } = useSession()
  const step = describeAuthFlow(flow)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetFlow()
        onOpenChange(next)
      }}
    >
      <DialogContent
        title={step.title}
        description={step.description}
      >
        {step.body}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {step.canDismiss ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                resetFlow()
                onOpenChange(false)
              }}
            >
              Not now
            </Button>
          ) : null}

          {step.primary === 'sign-in' ? (
            <Button
              size="sm"
              onClick={async () => {
                const session = await signIn()
                if (session) onOpenChange(false)
              }}
            >
              <Wallet aria-hidden="true" />
              Continue in Nimiq Pay
            </Button>
          ) : null}

          {step.primary === 'retry' ? (
            <Button
              size="sm"
              onClick={async () => {
                const session = await signIn()
                if (session) onOpenChange(false)
              }}
            >
              Try again
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface AuthStep {
  title: string
  description: ReactNode
  body: ReactNode
  primary: 'sign-in' | 'retry' | null
  canDismiss: boolean
}

function describeAuthFlow(flow: AuthFlowState): AuthStep {
  switch (flow.kind) {
    case 'IDLE':
      return {
        title: 'Sign in with your wallet',
        description: 'Nimpass uses your Nimiq wallet to identify you. No password needed.',
        body: <SignInExplainer />,
        primary: 'sign-in',
        canDismiss: true,
      }

    case 'REQUESTING_ACCOUNT':
      return {
        title: 'Choose your account',
        description: 'Nimiq Pay is asking which account to share with Nimpass.',
        body: <Waiting label="Waiting for Nimiq Pay…" />,
        primary: null,
        canDismiss: false,
      }

    case 'REQUESTING_CHALLENGE':
      return {
        title: 'Preparing sign-in…',
        description: 'Getting a one-time sign-in request from Nimpass.',
        body: <Waiting label="Just a moment…" />,
        primary: null,
        canDismiss: false,
      }

    case 'AWAITING_SIGNATURE':
      return {
        title: 'Approve the signature',
        description: 'Nimiq Pay is asking you to sign a short message.',
        body: (
          <>
            <Waiting label="Waiting for your approval…" />
            <p className="rounded-md bg-surface-muted p-3 text-small text-ink-muted">
              This is a signature, not a payment. No NIM leaves your wallet.
            </p>
          </>
        ),
        primary: null,
        canDismiss: false,
      }

    case 'VERIFYING':
      return {
        title: 'Signing you in…',
        description: 'Nimpass is checking your signature.',
        body: <Waiting label="Almost there…" />,
        primary: null,
        canDismiss: false,
      }

    case 'AUTHENTICATED':
      return {
        title: "You're signed in",
        description: 'Your passes and workspace are available now.',
        body: null,
        primary: null,
        canDismiss: true,
      }

    // A dismissed native dialog is a normal outcome, never an error.
    case 'CANCELLED':
      return {
        title: 'Sign-in cancelled',
        description: 'Nothing was signed and nothing was charged.',
        body: null,
        primary: 'retry',
        canDismiss: true,
      }

    case 'FAILED':
      return {
        title: "Couldn't sign you in",
        description: flow.message,
        body: null,
        // A missing wallet is not something retrying fixes.
        primary: flow.reason === 'WALLET_UNAVAILABLE' ? null : 'retry',
        canDismiss: true,
      }
  }
}

function SignInExplainer() {
  return (
    <ul className="space-y-3 text-body text-ink-muted">
      <li className="flex gap-3">
        <Wallet className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        Nimiq Pay asks which account you want to use.
      </li>
      <li className="flex gap-3">
        <PenLine className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        You sign a short message to prove the account is yours.{' '}
        <strong className="font-medium text-ink">No NIM is sent.</strong>
      </li>
      <li className="flex gap-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        Nimpass never sees your private key or recovery words.
      </li>
      <li className="pt-1 text-small text-ink-subtle">Connected to {networkLabel()}.</li>
    </ul>
  )
}

function Waiting({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2.5 text-body text-ink-muted" role="status" aria-live="polite">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </p>
  )
}
