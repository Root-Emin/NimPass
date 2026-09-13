import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Page, PageHeader } from '@/components/layout/page'
import { PassCard } from '@/components/pass/pass-card'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyPasses } from '@/hooks/use-passes'
import { useSession } from '@/hooks/use-session'
import { useWallet } from '@/hooks/use-wallet'
import { SignInDialog } from '@/components/wallet/sign-in-dialog'

/**
 * The customer's home base (docs/03-DESIGN-SYSTEM.md §48) — a calm list of
 * passes, not an analytics dashboard.
 *
 * Passes are private, so this is the first screen that genuinely needs a
 * wallet. Until one is connected we explain why rather than showing an error.
 */
export function MyPassesPage() {
  const { session, isRecovering } = useSession()
  const passes = useMyPasses()

  return (
    <Page>
      <PageHeader title="My Passes" description="Every package you've bought, and what's left on it." />

      <div className="mt-8">
        {isRecovering ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Skeleton className="h-52 rounded-lg" />
            <Skeleton className="h-52 rounded-lg" />
          </div>
        ) : !session ? (
          <SignInPrompt />
        ) : passes.isPending ? (
          <LoadingState label="Loading passes…" />
        ) : passes.isError ? (
          <ErrorState error={passes.error} onRetry={() => void passes.refetch()} />
        ) : passes.data.length === 0 ? (
          <EmptyState
            title="No passes yet"
            description="When you buy a session package, your pass will appear here."
            action={
              <Button asChild>
                <Link to="/discover">Discover</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {passes.data.map((pass) => (
              <PassCard key={pass.id} pass={pass} />
            ))}
          </div>
        )}
      </div>
    </Page>
  )
}

/**
 * Passes belong to an identity, and ownership is enforced server-side
 * (docs/09-SECURITY.md §32, §36). Without a session there is nothing honest to
 * show, so the page explains instead of rendering an empty list.
 */
function SignInPrompt() {
  const wallet = useWallet()
  const [signInOpen, setSignInOpen] = useState(false)
  const canSignIn = wallet.capabilities.walletOperationsAvailable

  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <p className="text-h3 font-semibold text-ink">Your passes are private</p>
      <p className="max-w-sm text-body text-ink-muted">
        {canSignIn
          ? 'Sign in with your wallet to see the passes you own.'
          : 'Open Nimpass in Nimiq Pay to see the passes you own.'}
      </p>
      {canSignIn ? (
        <>
          <Button onClick={() => setSignInOpen(true)}>Sign in</Button>
          <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
        </>
      ) : (
        <Button asChild variant="secondary">
          <Link to="/discover">Browse packages</Link>
        </Button>
      )}
    </Card>
  )
}
