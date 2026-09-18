import { AlertTriangle, LogIn, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Identicon } from '@/components/wallet/identicon'
import { SignInDialog } from '@/components/wallet/sign-in-dialog'
import { useSession } from '@/hooks/use-session'
import { useActiveWalletMismatch, useCanUseWallet, useWallet } from '@/hooks/use-wallet'
import { miniAppOpenerUrl, networkLabel } from '@/lib/nimiq'

/**
 * The header's identity affordance.
 *
 * Signed out: "Login" — one label and one action in every runtime, because it
 * *is* one action in every runtime. Inside Nimiq Pay it runs the native wallet
 * sign-in; in an ordinary browser it runs the same sign-in through the Nimiq
 * Hub. A desktop visitor is never told to fetch a phone in order to log in.
 *
 * Signed in: "Profile" plus the official Nimiq identicon, linking to the
 * profile page. Crypto chrome (truncated NQ address, wallet glyph) does not
 * belong in the bar once the person is already in; the address lives on the
 * profile page.
 *
 * Deliberately quiet (docs/03-DESIGN-SYSTEM.md, "Product Character"): no
 * balance, no full address, no network chrome. It is also never a gate — public
 * discovery works without it (docs/02-USER-FLOWS.md §5).
 *
 * What it shows is the *Nimpass session*, not the wallet's account list. An
 * address a wallet revealed is not an authenticated identity
 * (docs/09-SECURITY.md §11, §19), so a signed-in state here always means the
 * backend verified a signature.
 */
export function WalletControl() {
  const { session, isRecovering } = useSession()
  const mismatch = useActiveWalletMismatch()
  const canSignIn = useCanUseWallet()
  const [signInOpen, setSignInOpen] = useState(false)

  // Only the session decides between Login and Profile, so only the session
  // recovery is worth waiting for. Wallet detection runs underneath and never
  // holds up the header: every runtime has a wallet to reach, and a spinner
  // where Login belongs would be the wrong answer on every page load.
  if (isRecovering) {
    return <Skeleton className="h-11 w-24 rounded-full sm:h-9" />
  }

  if (session) {
    return (
      <Link
        to="/profile"
        aria-label="Profile"
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-3 text-small text-ink-muted transition-colors hover:border-line-strong hover:text-ink sm:min-h-9"
      >
        <span className="relative flex">
          <Identicon address={session.identity.wallet} size={24} />
          {/*
            A drifted wallet is state the user has to be able to notice from
            anywhere, not only once they open the profile page
            (docs/02-USER-FLOWS.md §9). The dot marks it; the profile page
            explains it. Never colour alone — the icon carries the meaning.
          */}
          {mismatch ? (
            <span className="absolute -right-0.5 -top-0.5 flex size-3 items-center justify-center rounded-full bg-warning text-ink">
              <AlertTriangle className="size-2" aria-hidden="true" />
              <span className="sr-only">Wallet changed</span>
            </span>
          ) : null}
        </span>
        <span className="font-medium text-ink" aria-hidden="true">
          Profile
        </span>
      </Link>
    )
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="rounded-full"
        onClick={() => setSignInOpen(true)}
      >
        <LogIn aria-hidden="true" />
        Login
      </Button>

      {canSignIn ? (
        <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
      ) : (
        // Neither transport could be established — the Nimiq Pay host injected
        // no provider, or the Hub client could not be loaded at all. Rare, and
        // the honest thing is to say so and offer a retry rather than pretend
        // the action exists (docs/08-ARCHITECTURE.md §87).
        <NoWalletDialog open={signInOpen} onOpenChange={setSignInOpen} />
      )}
    </>
  )
}

function NoWalletDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const wallet = useWallet()
  const opener = miniAppOpenerUrl()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Wallet login isn't available right now"
        description={
          wallet.error
            ? wallet.error.message
            : "Nimpass has no passwords — your Nimiq wallet is your account. We couldn't reach a wallet from this page."
        }
      >
        <p className="text-small text-ink-subtle">
          Browsing works without a wallet. This build is connected to {networkLabel(wallet.network)}.
        </p>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" size="sm" onClick={() => void wallet.refresh()}>
            Try again
          </Button>
          {/* An option, never the only route: the same page continues inside
              Nimiq Pay for someone who has it (docs/04-NIMIQ-MINI-APPS.md
              §41-§42). Null where a handoff cannot work — local development,
              mainly — and then the copy above stands alone. */}
          {opener ? (
            <Button asChild size="sm">
              <a href={opener} rel="noreferrer">
                <Wallet aria-hidden="true" />
                Open in Nimiq Pay
              </a>
            </Button>
          ) : (
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Got it
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
