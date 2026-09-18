import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ProviderAvatar } from '@/components/provider/provider-avatar'
import { Card } from '@/components/ui/card'
import { providerPath } from '@/lib/provider-url'
import { Skeleton } from '@/components/ui/skeleton'
import type { PublicProvider } from '@/types/domain'

/**
 * A provider, as much as the contract lets us show.
 *
 * The face is the owner's Nimiq identicon (and a photograph when they uploaded
 * one). The name is the display name they chose. Followers, likes and
 * engagement counters stay absent (docs/03-DESIGN-SYSTEM.md §38).
 */
export function ProviderCard({
  provider,
  passCount,
}: {
  provider: PublicProvider
  /** Counted from the published passes already on screen, not guessed. */
  passCount?: number
}) {
  return (
    // `min-w-0`: a grid item's automatic minimum size is its content's
    // min-content width, and a nowrap `truncate` line has a min-content width
    // equal to its whole text. A provider with a long name or headline
    // therefore widened the grid track past the page and scrolled the whole
    // document sideways. This lets the track be the container's width and lets
    // the truncation do its job.
    <Card variant="plain" interactive className="group min-w-0">
      <Link to={providerPath(provider)} className="flex h-full items-center gap-4 p-5">
        <ProviderAvatar
          wallet={provider.wallet}
          avatarUrl={provider.avatarUrl}
          variant={provider.avatarVariant}
          name={provider.name}
          size={44}
        />

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-body-lg font-semibold text-ink">
            {provider.name}
          </p>
          {provider.headline.trim() ? (
            <p className="mt-0.5 truncate text-small text-ink-muted">{provider.headline}</p>
          ) : null}
          {/*
            How much this provider has on sale, when the caller was given a
            count by the backend. It used to be an *alternative* to the
            headline, shown only to providers who had not written one — which
            meant the directory's one piece of shopping information was missing
            from exactly the profiles that were most filled in.
          */}
          {passCount !== undefined ? (
            <p className="mt-0.5 text-small text-ink-subtle">
              {passCount === 1 ? '1 pass' : `${passCount} passes`}
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
    <Card variant="plain" className="flex items-center gap-4 p-5">
      <Skeleton className="size-11 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </Card>
  )
}
