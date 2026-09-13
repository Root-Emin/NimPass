import { PackageCard, PackageCardSkeleton } from '@/components/package/package-card'
import { EmptyState, ErrorState } from '@/components/ui/states'
import type { PackageListing } from '@/types/domain'
import type { ReactNode } from 'react'

/**
 * One place that decides how a package list renders in each of its states, so
 * every surface tells the same story.
 *
 * "Nothing matched your filters" and "we could not reach Nimpass" are different
 * outcomes and get different surfaces — the brief's §21 distinction.
 */
export function PackageGrid({
  items,
  isPending,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyAction,
  skeletonCount = 6,
}: {
  items: PackageListing[] | undefined
  isPending: boolean
  error: unknown
  onRetry?: () => void
  emptyTitle: string
  emptyDescription?: ReactNode
  emptyAction?: ReactNode
  skeletonCount?: number
}) {
  if (isPending) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: skeletonCount }, (_, index) => (
          <PackageCardSkeleton key={index} />
        ))}
      </div>
    )
  }

  if (error) return <ErrorState error={error} onRetry={onRetry} />

  if (!items || items.length === 0) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
    )
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <PackageCard key={item.id} item={item} />
      ))}
    </div>
  )
}
