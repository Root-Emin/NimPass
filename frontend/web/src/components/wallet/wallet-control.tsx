import { LogOut, Wallet } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { SignInDialog } from '@/components/wallet/sign-in-dialog'
import { useSession } from '@/hooks/use-session'
import { useWallet } from '@/hooks/use-wallet'
import { normaliseAddress, shortenAddress } from '@/lib/format'
import { miniAppOpenerUrl, networkLabel } from '@/lib/nimiq'

/**
 * The header's wallet affordance.
 *
 * Deliberately quiet (docs/03-DESIGN-SYSTEM.md §33): no balance, no full
 * address, no network chrome. It is also never a gate — public discovery works
 * without it (docs/02-USER-FLOWS.md §5).
 *
 * What it shows is the *Nimpass session*, not the wallet's account list. An
 * address revealed by Nimiq Pay is not an authenticated identity
 * (docs/09-SECURITY.md §11, §19), so a signed-in state here always means the
 * backend verified a signature.
 */
export function WalletControl() {
  const wallet = useWallet()
  const { session, isRecovering, signOut } = useSession()
  const [signInOpen, setSignInOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  if (wallet.status === 'initializing' || isRecovering) {
    return <Skeleton className="h-11 w-24 rounded-full sm:h-9" />
  }

  if (session) {
    /*
     * The wallet's active account and the signed-in identity can drift apart:
     * Nimiq Pay lets someone switch accounts while a Nimpass session is open,
     * and that session stays bound to the wallet it was issued for.
     *
     * Nothing unsafe follows from that — the session identity is the backend's,
     * and every consequential operation is checked against it server-side. What
     * follows is *confusing*: a payment signed by the new account fails the
     * backend's sender check, and a redemption signature fails verification,
     * both with errors that look like bugs rather than like "you switched
     * wallets". Saying so plainly turns a mystifying failure into an obvious
     * one-step fix (§24).
     *
     * Compared on the normalised form, because addresses are displayed with
     * spaces and the wallet may hand them back either way.
     */
    const active = wallet.account
    const mismatched =
      active !== null && normaliseAddress(active) !== normaliseAddress(session.identity.wallet)

    return (
      <>
        <button
          type="button"
          onClick={() => setAccountOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-small text-ink-muted transition-colors hover:border-line-strong hover:text-ink sm:min-h-9"
        >
          <Wallet className="size-3.5 text-accent" aria-hidden="true" />
          <span className="font-medium text-ink">{shortenAddress(session.identity.wallet)}</span>
        </button>

        <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
          <DialogContent
            title="Your Nimpass account"
            description={`Signed in with ${shortenAddress(session.identity.wallet)} on ${networkLabel(wallet.network)}.`}
          >
            {mismatched ? (
              <div className="rounded-md border border-warning/25 bg-warning-soft p-4" role="status">
                <p className="text-body font-medium text-ink">You've switched wallets</p>
                <p className="mt-1 text-small text-ink-muted">
                  Nimpass is signed in with {shortenAddress(session.identity.wallet)}, but your
                  wallet is now on {shortenAddress(active)}. Sign out and back in to use this one —
                  otherwise payments and session codes will be refused.
                </p>
              </div>
            ) : null}

            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await signOut()
                  setAccountOpen(false)
                }}
              >
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  const canSignIn = wallet.capabilities.walletOperationsAvailable
  const opener = canSignIn ? null : miniAppOpenerUrl()

  return (
    <>
      <Button
        variant={canSignIn ? 'secondary' : 'ghost'}
        size="sm"
        className="rounded-full"
        onClick={() => setSignInOpen(true)}
      >
        <Wallet aria-hidden="true" />
        {canSignIn ? 'Sign in' : 'Wallet'}
      </Button>

      {canSignIn ? (
        <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
      ) : (
        // No provider in this runtime: explain rather than offer a dead action.
        <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
          <DialogContent
            title="Wallet actions happen in Nimiq Pay"
            description={
              wallet.status === 'error' && wallet.error
                ? wallet.error.message
                : 'You can browse providers and packages here. Signing in, buying a pass and using a session need Nimiq Pay.'
            }
          >
            <p className="text-small text-ink-subtle">
              Open Nimpass inside the Nimiq Pay app to continue. This build is connected to{' '}
              {networkLabel(wallet.network)}.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {wallet.status === 'error' ? (
                <Button variant="secondary" size="sm" onClick={() => void wallet.refresh()}>
                  Try again
                </Button>
              ) : null}
              {/* Continues on the page the user is actually on, rather than
                  leaving them to find it again (docs/04-NIMIQ-MINI-APPS.md
                  §41-§42). Null where a handoff cannot work — local
                  development, mainly — and then the copy above stands alone. */}
              {opener ? (
                <Button asChild size="sm">
                  <a href={opener} rel="noreferrer">
                    <Wallet aria-hidden="true" />
                    Open in Nimiq Pay
                  </a>
                </Button>
              ) : (
                <Button size="sm" onClick={() => setSignInOpen(false)}>
                  Got it
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
