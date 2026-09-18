import { Link } from 'react-router-dom'

import { PassCoverArt } from '@/components/catalog/pass-cover-art'
import { PASS_COVER_RATIO_CLASS } from '@/components/catalog/pass-cover-ratios'
import { ProviderAvatar } from '@/components/provider/provider-avatar'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNim, formatSessions } from '@/lib/format'
import { PASS_ACCENTS, resolveAccent } from '@/lib/pass-accent'
import { serviceKind } from '@/lib/service-kind'
import { resolveCoverUrl } from '@/api/media'
import { cn } from '@/lib/utils'
import type { PassListing } from '@/types/domain'

/**
 * Content hierarchy follows docs/03-DESIGN-SYSTEM.md §36:
 *   service/pass → provider → sessions → price → CTA.
 *
 * The cover is a photograph when the provider uploaded one, otherwise the
 * colour field they chose. The session count still sits on it, because the
 * number of sessions is what the customer is actually buying.
 *
 * The whole card is one link: a separate "View pass" button would compete
 * with the real primary action on the page it leads to (§73).
 */
export function CatalogPassCard({ item }: { item: PassListing }) {
  const kind = serviceKind(item.service.name)
  const tone = PASS_ACCENTS[resolveAccent(item.accent, item.service.name, kind.id)]
  const coverSrc = resolveCoverUrl(item.coverUrl)

  return (
    <Card interactive className="group overflow-hidden">
      <Link to={`/pass/${item.id}`} className="flex h-full flex-col">
        <PassCoverArt
          seed={item.provider.name}
          tone={{ from: tone.from, to: tone.to }}
          coverSrc={coverSrc}
          className="flex items-end justify-end p-4"
        >
          <span
            aria-hidden="true"
            className="numeric font-display text-[2.75rem] font-semibold leading-none text-white/35"
          >
            {item.sessions}
          </span>
        </PassCoverArt>

        <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
          <div className="space-y-2">
            {sameAsTitle(item.service.name, item.title) ? null : (
              <p className="eyebrow text-ink-subtle">{item.service.name}</p>
            )}
            <h3 className="text-h3 text-ink">{item.title}</h3>
            <p className="flex items-center gap-2 truncate text-body text-ink-muted">
              <ProviderAvatar
                wallet={item.provider.wallet}
                avatarUrl={item.provider.avatarUrl}
                variant={item.provider.avatarVariant}
                name={item.provider.name}
                size={20}
              />
              <span className="truncate">{item.provider.name}</span>
            </p>
          </div>

          {/* Sessions lead, price supports: the product is the sessions, not
              the token amount (§36, §20). */}
          <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-line pt-4">
            <span className="text-body font-medium text-ink">{formatSessions(item.sessions)}</span>
            <span className="numeric font-display text-body-lg font-semibold text-ink">
              {formatNim(item.priceLuna)}
            </span>
          </div>
        </div>
      </Link>
    </Card>
  )
}

export function CatalogPassCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className={cn(PASS_COVER_RATIO_CLASS, 'w-full rounded-none')} />
      <div className="space-y-4 p-5 sm:p-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="flex justify-between border-t border-line pt-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
    </Card>
  )
}

/**
 * Whether the service line would only repeat the pass name.
 *
 * The Pass form no longer asks what a pass is for — it derives the service from
 * the pass's own name — so the two are frequently the same string. Printing it
 * twice reads as a rendering fault rather than as context.
 */
function sameAsTitle(serviceName: string, title: string): boolean {
  return serviceName.trim().toLowerCase() === title.trim().toLowerCase()
}
