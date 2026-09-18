import { useState, type ReactNode } from 'react'
import { Link, Outlet } from 'react-router-dom'

import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SignInDialog } from '@/components/wallet/sign-in-dialog'
import { useSession } from '@/hooks/use-session'
import { useCanUseWallet } from '@/hooks/use-wallet'

/**
 * Route guard for the two areas that belong to an identity: the customer's
 * passes and the provider workspace.
 *
 * Public-first browsing is a product rule — the catalogue, a provider and a
 * pass stay open to a visitor who has not touched a wallet yet
 * (docs/02-USER-FLOWS.md §5, §28). Everything *owned* is the opposite: it only
 * exists for a backend-verified session, so the area itself — its headings,
 * its navigation, its shape — is not rendered at all until there is one.
 *
 * It replaces the page rather than redirecting. Destination intent survives a
 * deep link (docs/02-USER-FLOWS.md §6, docs/08-ARCHITECTURE.md §81): the URL
 * stays put, and the page it names renders the moment the session appears,
 * without a second navigation.
 *
 * This is a UX boundary, not the security one. Every pass, purchase and
 * provider endpoint is authorised server-side regardless of what the client
 * chooses to render (docs/09-SECURITY.md §33, §37, docs/08-ARCHITECTURE.md
 * §11), and a known URL still grants nothing (§80).
 */
export function RequireSession({
  intent,
  children,
}: {
  intent: 'passes' | 'provider' | 'purchase'
  children?: ReactNode
}) {
  const { session, isRecovering } = useSession()

  // A recovered session arrives one request after first paint (docs/09 §61).
  // Announcing "log in" before that answer lands would tell a signed-in
  // customer they are signed out.
  if (isRecovering) return <GateSkeleton />
  if (!session) return <SignInGate intent={intent} />

  return <>{children ?? <Outlet />}</>
}

function GateSkeleton() {
  return (
    <Page>
      <Skeleton className="h-10 w-56 rounded-lg" />
      <Skeleton className="mt-10 h-64 rounded-2xl" />
    </Page>
  )
}

const COPY = {
  purchase: { title: 'Log in to continue this purchase', signedOut: 'Use the same Nimiq wallet you used on desktop. The purchase stays linked to that wallet.', noWallet: 'Open this purchase inside Nimiq Pay to log in with your wallet.' },
  passes: {
    title: 'Your passes are private',
    signedOut: 'Log in with your wallet to see the passes you own.',
    noWallet: "We couldn't reach a Nimiq wallet, so there's no way to log in from this page.",
  },
  provider: {
    title: 'Log in to manage your workspace',
    signedOut: 'Your services, passes and sales are tied to your wallet. Log in to load them.',
    noWallet:
      "Your services, passes and sales are tied to your wallet, and we couldn't reach one from this page.",
  },
} as const

/**
 * The whole page for a visitor without a session.
 *
 * It says what the area is and offers the one action that opens it — the same
 * sign-in the header runs, so there is never a second way to authenticate
 * (docs/09-SECURITY.md §12-§20). That action works in every runtime: Nimiq Pay
 * inside the Mini App, the Nimiq Hub in a browser. Only when neither can be
 * reached does the copy say so, instead of offering a button that cannot work
 * (docs/08-ARCHITECTURE.md §87).
 */
function SignInGate({ intent }: { intent: 'passes' | 'provider' | 'purchase' }) {
  const [signInOpen, setSignInOpen] = useState(false)
  const canSignIn = useCanUseWallet()
  const copy = COPY[intent]

  return (
    <Page>
      <Card variant="muted" className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <h1 className="text-h3 text-ink">{copy.title}</h1>
        <p className="max-w-sm text-body text-ink-muted">
          {canSignIn ? copy.signedOut : copy.noWallet}
        </p>
        {canSignIn ? (
          <>
            <Button onClick={() => setSignInOpen(true)}>Login</Button>
            <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
          </>
        ) : (
          <Button asChild variant="secondary">
            <Link to="/discover">Browse Nimpass</Link>
          </Button>
        )}
      </Card>
    </Page>
  )
}
