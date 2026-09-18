import { Loader2, PenLine, ShieldCheck, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useSession } from '@/hooks/use-session'
import { useWallet } from '@/hooks/use-wallet'
import { shortenAddress } from '@/lib/format'
import { networkLabel } from '@/lib/nimiq'
import type { AuthFlowState } from '@/types/auth'

/**
 * Explains the sign-in before it happens, then narrates it.
 *
 * The flow is the same everywhere: the wallet names an account, the backend
 * issues a one-time challenge, the wallet signs it, the backend verifies it.
 * Only the surface differs — Nimiq Pay's native sheets inside the Mini App, the
 * Nimiq Hub's window in an ordinary browser — and the copy says "your wallet"
 * rather than naming either.
 *
 * Where the runtime genuinely changes what the user must *do*, it shows: a
 * transport that needs a click per wallet window pauses at `WALLET_SELECTED`
 * and asks for the signature explicitly, because a second window opened without
 * a second click would simply be blocked.
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
  const { capabilities } = useWallet()
  const step = describeAuthFlow(flow, capabilities.gesturePerOperation)

  const start = async () => {
    const session = await signIn()
    if (session) onOpenChange(false)
  }

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

          {step.primary ? (
            // `signIn` is called directly from the click, with nothing awaited
            // before it, so a transport that opens a browser window still has
            // the activation it needs (https://nimiq.dev/hub/getting-started).
            <Button size="sm" onClick={() => void start()}>
              {step.primary.icon}
              {step.primary.label}
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
  primary: { label: string; icon?: ReactNode } | null
  canDismiss: boolean
}

function describeAuthFlow(flow: AuthFlowState, gesturePerOperation: boolean): AuthStep {
  switch (flow.kind) {
    case 'IDLE':
      return {
        title: 'Log in with your wallet',
        description:
          'Your Nimiq wallet is your Nimpass account. No username, no password — and the first login creates the account.',
        body: <SignInExplainer gesturePerOperation={gesturePerOperation} />,
        primary: {
          label: gesturePerOperation ? 'Choose wallet in Nimiq Hub' : 'Continue in Nimiq Pay',
          icon: <Wallet aria-hidden="true" />,
        },
        canDismiss: true,
      }

    case 'REQUESTING_ACCOUNT':
      return {
        title: 'Choose your account',
        description: 'Your wallet is asking which account to share with Nimpass.',
        body: <Waiting label="Waiting for your wallet…" />,
        primary: null,
        canDismiss: false,
      }

    case 'REQUESTING_CHALLENGE':
      return {
        title: 'Preparing your login…',
        description: 'Getting a one-time login request from Nimpass.',
        body: <Waiting label="Just a moment…" />,
        primary: null,
        canDismiss: false,
      }

    // The pause a gesture-per-window transport needs. Nothing is in flight: the
    // login request already exists and is waiting for the user to approve it.
    case 'WALLET_SELECTED':
      return {
        title: 'Sign to finish logging in',
        description: `Nimpass prepared a one-time login request for ${shortenAddress(flow.wallet)}.`,
        body: (
          <p className="rounded-md bg-surface-muted p-3 text-small text-ink-muted">
            Your wallet opens once more to sign it. This is a signature, not a payment — no NIM
            leaves your wallet.
          </p>
        ),
        primary: { label: 'Sign and log in', icon: <PenLine aria-hidden="true" /> },
        canDismiss: true,
      }

    case 'AWAITING_SIGNATURE':
      return {
        title: 'Approve the signature',
        description: 'Your wallet is asking you to sign a short message.',
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

    // A dismissed wallet dialog is a normal outcome, never an error.
    case 'CANCELLED':
      return {
        title: 'Login cancelled',
        description: 'Nothing was signed and nothing was charged.',
        body: null,
        primary: { label: 'Try again' },
        canDismiss: true,
      }

    case 'FAILED':
      return {
        title: "Couldn't log you in",
        description: flow.message,
        body: null,
        // A missing wallet is not something retrying fixes. A blocked pop-up is:
        // the user allows it and presses again, which is why it is not folded
        // into WALLET_UNAVAILABLE.
        primary: flow.reason === 'WALLET_UNAVAILABLE' ? null : { label: 'Try again' },
        canDismiss: true,
      }
  }
}

function SignInExplainer({ gesturePerOperation }: { gesturePerOperation: boolean }) {
  return (
    <ul className="space-y-3 text-body text-ink-muted">
      <li className="flex gap-3">
        <Wallet className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        {gesturePerOperation
          ? 'Nimiq Hub opens a browser wallet. Choose an existing wallet you control; this does not connect to your phone automatically.'
          : 'Nimiq Pay asks which account you want to use.'}
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
      <li className="pt-1 text-small text-ink-subtle">
        First time here? This same step creates your Nimpass account. Connected to{' '}
        {networkLabel()}.
      </li>
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
