import { Link } from 'react-router-dom'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNim, formatSessions } from '@/lib/format'
import type { PackageListing } from '@/types/domain'

/**
 * Content hierarchy follows docs/03-DESIGN-SYSTEM.md §36:
 *   service/package → provider → sessions → price → CTA.
 *
 * The contract's public offer carries no package image, no service category and
 * no provider avatar, so the card is typographic rather than image-led. That is
 * a real constraint, not a style choice: inventing a placeholder identity would
 * be fabricating provider data (docs/08-ARCHITECTURE.md §11). Whitespace and
 * type do the work instead (§12, §21).
 */
export function PackageCard({ item }: { item: PackageListing }) {
  return (
    <Card className="group transition-shadow duration-[--nimpass-duration-base] hover:shadow-lift">
      <Link to={`/packages/${item.id}`} className="flex h-full flex-col gap-4 p-5 sm:p-6">
        <div className="space-y-1.5">
          <p className="text-micro font-medium uppercase tracking-[0.08em] text-ink-subtle">
            {item.service.name}
          </p>
          <h3 className="text-h3 leading-snug text-ink">{item.title}</h3>
        </div>

        <p className="truncate text-small text-ink-muted">{item.provider.name}</p>

        {/* Sessions lead, price supports: the product is the sessions, not the
            token amount (docs/03-DESIGN-SYSTEM.md §36, §20). */}
        <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-line pt-4">
          <span className="font-display text-body-lg font-semibold text-ink">
            {formatSessions(item.sessions)}
          </span>
          <span className="text-body text-ink-muted">{formatNim(item.priceLuna)}</span>
        </div>
      </Link>
    </Card>
  )
}

export function PackageCardSkeleton() {
  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-3/4" />
      </div>
      <Skeleton className="h-4 w-28" />
      <div className="flex justify-between border-t border-line pt-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>
    </Card>
  )
}
