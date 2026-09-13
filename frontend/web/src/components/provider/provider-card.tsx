import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { initialsOf } from '@/lib/format'
import type { PublicProvider } from '@/types/domain'

/**
 * A provider, as much as the contract lets us show.
 *
 * `PublicProvider` is `{ id, name }`. There is no headline, bio, location,
 * avatar or service count server-side, so the card shows an initials mark and
 * the name. Everything that used to sit here was frontend-only decoration and
 * has been removed rather than filled with placeholders
 * (docs/08-ARCHITECTURE.md §11).
 *
 * Still deliberately absent even when those fields arrive: followers, likes and
 * engagement counters (docs/03-DESIGN-SYSTEM.md §38).
 */
export function ProviderCard({
  provider,
  packageCount,
}: {
  provider: PublicProvider
  /** Counted from the published packages already on screen, not guessed. */
  packageCount?: number
}) {
  return (
    <Card className="group transition-shadow duration-[--nimpass-duration-base] hover:shadow-lift">
      <Link
        to={`/providers/${provider.id}`}
        className="flex h-full items-center gap-3.5 p-5"
      >
        <Avatar className="size-12">
          <AvatarFallback>{initialsOf(provider.name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-body-lg font-semibold text-ink">
            {provider.name}
          </p>
          {packageCount !== undefined ? (
            <p className="mt-0.5 text-small text-ink-subtle">
              {packageCount === 1 ? '1 package' : `${packageCount} packages`}
            </p>
          ) : null}
        </div>

        <ArrowUpRight
          className="size-4 shrink-0 text-ink-subtle transition-colors group-hover:text-ink"
          aria-hidden="true"
        />
      </Link>
    </Card>
  )
}

export function ProviderCardSkeleton() {
  return (
    <Card className="flex items-center gap-3.5 p-5">
      <Skeleton className="size-12 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </Card>
  )
}
