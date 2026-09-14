import { Check } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import type { RedemptionHistoryItem } from '@/types/domain'

/**
 * The sessions actually used on a pass.
 *
 * Every row is a consumed session the backend recorded inside the transaction
 * that decremented the counter — so this list and the remaining count can never
 * disagree. Challenges that expired, were cancelled, or were never authorised
 * leave nothing behind, which is right: no session was used, so there is no
 * event to show.
 *
 * `sessionOrdinal` comes from the backend. Numbering the rows here would
 * renumber history every time the list was filtered or paged
 * (docs/01-PRODUCT.md §27, docs/08-ARCHITECTURE.md §49).
 */
export function SessionHistory({
  items,
  isPending,
}: {
  items: RedemptionHistoryItem[] | undefined
  isPending: boolean
}) {
  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    )
  }

  if (!items || items.length === 0) {
    return (
      <p className="text-body text-ink-muted">
        No sessions used yet. When your provider confirms one, it appears here.
      </p>
    )
  }

  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.redemptionId} className="flex items-baseline gap-3">
          <span className="mt-0.5 shrink-0 text-success" aria-hidden="true">
            <Check className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-body text-ink">Session {item.sessionOrdinal}</p>
            <p className="text-small text-ink-subtle">{formatDateTime(item.redeemedAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
