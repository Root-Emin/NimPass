import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { useProviderAccount } from '@/hooks/use-provider-workspace'

/**
 * Waits for the answer to one question — *does this wallet own a provider
 * record?* — and then gets out of the way.
 *
 * It is deliberately not a gate. Owning no provider used to be an interstitial
 * ("Set up your workspace") standing in front of My Store and in front of the
 * Pass form, which made becoming a seller a setup step with its own screen —
 * the last piece of the workspace ADR-008 removed. A wallet that has never sold
 * anything now sees the same two screens as one that has: an empty store, and
 * a form (`docs/DECISIONS.md` ADR-020). The provider record is created by the
 * first Pass, not before it.
 *
 * What still has to wait here is the *loading* of that answer, because the Pass
 * form composes itself differently depending on it, and the *failure* of it,
 * because a profile request that could not be answered must not render as an
 * empty store — that would tell a provider they have nothing.
 *
 * Sign-in is not handled here: every route that uses this sits behind
 * `RequireSession`, which replaces the whole page when there is no session
 * (docs/09-SECURITY.md §67). Authorisation remains the backend's alone; nothing
 * rendered here grants provider authority (§33).
 */
export function ProviderAccountBoundary({ children }: { children: ReactNode }) {
  const account = useProviderAccount()

  switch (account.status) {
    case 'unauthenticated':
      // Unreachable behind `RequireSession`, which has already replaced the
      // page. Rendering the area anyway would be the one wrong answer.
      return null

    case 'loading':
      return (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      )

    case 'error':
      return <ErrorState error={account.error} />

    case 'none':
    case 'ready':
      return <>{children}</>
  }
}
