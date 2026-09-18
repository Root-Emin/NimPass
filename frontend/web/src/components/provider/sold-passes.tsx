import { Link } from 'react-router-dom'

import { Subsection } from '@/components/layout/page'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { useProviderSoldPasses } from '@/hooks/use-pass-sessions'
import { useProviderAccount } from '@/hooks/use-provider-workspace'
import { formatDate, shortenId } from '@/lib/format'
import type { PurchasedPass } from '@/types/domain'

/**
 * The passes people have actually bought from this provider.
 *
 * My Store used to say, in a comment, that there was deliberately no such
 * list because the API exposed no provider-side view of purchased passes and
 * inventing "3 sold" was the one thing the screen must not do. The API exposes
 * one now — `GET /providers/{id}/purchased-passes`, scoped server-side to this
 * account — so the honest version of that number exists and the provider can
 * open the pass behind it.
 *
 * Opening one leads to the *same* pass screen the customer uses. Not a
 * provider copy of it: the same route, the same record, the same sessions.
 * That is what makes "the provider marked session 3 done" and "the customer
 * sees session 3 done" one fact rather than two systems agreeing
 * (docs/01-PRODUCT.md §33).
 *
 * Still not a workspace (DECISIONS.md ADR-008): a list of objects the provider
 * owes work on, in the same card language as everything else, with no
 * dashboard around it.
 */
export function SoldPasses() {
  const account = useProviderAccount()
  const sold = useProviderSoldPasses(account.providerId ?? undefined)

  if (account.status !== 'ready') return null

  return (
    <Subsection title="Sold passes" action={<Count items={sold.data} />}>
      {sold.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : sold.isError ? (
        <ErrorState error={sold.error} onRetry={() => void sold.refetch()} />
      ) : (sold.data?.length ?? 0) === 0 ? (
        <p className="text-body text-ink-muted">
          Nobody has bought one of your passes yet. When someone does, it appears here with its
          sessions.
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {sold.data?.map((pass) => (
            <SoldPassRow key={pass.id} pass={pass} />
          ))}
        </ul>
      )}
    </Subsection>
  )
}

function Count({ items }: { items: PurchasedPass[] | undefined }) {
  if (!items || items.length === 0) return null
  return (
    <span className="text-small text-ink-subtle">
      {items.length} {items.length === 1 ? 'customer' : 'customers'}
    </span>
  )
}

function SoldPassRow({ pass }: { pass: PurchasedPass }) {
  return (
    <li>
      <Link
        to={`/passes/${pass.id}`}
        className="flex items-baseline justify-between gap-4 py-4 hover:bg-surface-muted"
      >
        <div className="min-w-0">
          <p className="truncate text-body text-ink">{pass.passTitle}</p>
          <p className="mt-0.5 text-small text-ink-subtle">
            {/* The buyer is a wallet, and a wallet is all Nimpass knows about
                them. Shortened, because the full address is noise here. */}
            <span className="numeric" title={pass.ownerWallet}>
              {shortenId(pass.ownerWallet)}
            </span>{' '}
            · bought {formatDate(pass.createdAt)}
          </p>
        </div>
        <p className="shrink-0 text-small text-ink-muted">
          {pass.status === 'ACTIVE'
            ? `${pass.remainingSessions} of ${pass.originalSessions} left`
            : `${pass.status.charAt(0)}${pass.status.slice(1).toLowerCase()}`}
        </p>
      </Link>
    </li>
  )
}
