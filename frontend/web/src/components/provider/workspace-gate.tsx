import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { useProviderAccount } from '@/hooks/use-provider-workspace'
import { useWallet } from '@/hooks/use-wallet'
import { SignInDialog } from '@/components/wallet/sign-in-dialog'

/**
 * Wraps a workspace region that needs a provider account.
 *
 * The workspace itself stays browsable without a wallet — navigation, headings
 * and structure are all visible — but anything that reads or writes real
 * provider data says plainly what it needs. Nothing is invented to fill the gap
 * (docs/08-ARCHITECTURE.md §11).
 *
 * It gates on two separate things, because they are two separate questions
 * (docs/09-SECURITY.md §67): *is there a session* (authentication), and *does
 * this identity own a provider* (authorisation). A customer who opens
 * `/provider` is authenticated and has no provider record — a normal state that
 * deserves an explanation, not an error and not a screen of skeletons waiting
 * on queries that will never run.
 *
 * The gate is a UX affordance only. Every provider endpoint is authorised
 * server-side regardless of what is rendered here (§33).
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const account = useProviderAccount()

  switch (account.status) {
    case 'unauthenticated':
      return <SignInCard />

    case 'loading':
      return (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-lg" />
          ))}
        </div>
      )

    case 'error':
      return <ErrorState error={account.error} />

    case 'none':
      return <NoProviderCard />

    case 'ready':
      return <>{children}</>
  }
}

function SignInCard() {
  const wallet = useWallet()
  const [signInOpen, setSignInOpen] = useState(false)
  const canConnect = wallet.capabilities.walletOperationsAvailable

  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <h2 className="text-h3 text-ink">Sign in to manage your workspace</h2>
      <p className="max-w-lg text-body text-ink-muted">
        {canConnect
          ? 'Your services, packages and sales are tied to your wallet. Sign in to load them.'
          : 'Your services, packages and sales are tied to your wallet. Open Nimpass in Nimiq Pay to manage them.'}
      </p>
      {canConnect ? (
        <>
          <Button onClick={() => setSignInOpen(true)}>Sign in</Button>
          <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
        </>
      ) : (
        <Button asChild variant="secondary">
          <Link to="/discover">Browse Nimpass</Link>
        </Button>
      )}
    </Card>
  )
}

/**
 * Signed in, but this identity sells nothing yet.
 *
 * Creating the provider record is a backend operation and there is no frontend
 * path to it yet, so this states the situation plainly rather than offering a
 * button that cannot work.
 */
function NoProviderCard() {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <h2 className="text-h3 text-ink">You don't have a provider account yet</h2>
      <p className="max-w-lg text-body text-ink-muted">
        The workspace is where you publish session packages and get paid in NIM. This wallet
        isn't set up to sell yet, so there's nothing here to manage.
      </p>
      <Button asChild variant="secondary">
        <Link to="/passes">Go to My Passes</Link>
      </Button>
    </Card>
  )
}
