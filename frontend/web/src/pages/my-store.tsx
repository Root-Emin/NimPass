import { ExternalLink, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { CreatedPassCard, CreatedPassCardSkeleton } from '@/components/catalog/created-pass-card'
import { Page, PageHeader } from '@/components/layout/page'
import { SoldPasses } from '@/components/provider/sold-passes'
import { ProviderAccountBoundary } from '@/components/provider/account-boundary'
import { Button } from '@/components/ui/button'
import { ShareButton } from '@/components/ui/share-button'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { useMyCatalogPasses, useMyProviderProfile } from '@/hooks/use-provider-workspace'
import { formatNim } from '@/lib/format'
import { providerPath, providerUrl } from '@/lib/provider-url'
import type { Pass } from '@/types/domain'

/**
 * My Store — the Passes this wallet has made.
 *
 * Nimpass has one kind of account. The same wallet buys passes and sells them,
 * so the collection is split by *what a pass is to you* rather than by a role:
 * My Passes is what you bought (`GET /passes`, purchased passes with their own
 * session counts), and this is what you made (`GET /providers/{id}/passes`, the
 * catalog Passes other people buy). The two never merge — they are different
 * objects with different lifecycles (docs/08-ARCHITECTURE.md §41).
 *
 * It is a page, not a workspace: no sidebar, no dashboard, no role switch. The
 * cards are the same card language the rest of the product uses for a Pass, and
 * opening one goes to the screen where that Pass is edited and published.
 *
 * Below the grid are the passes people have actually bought, from
 * `GET /providers/{id}/purchased-passes`. Every number there is one the
 * backend reported; nothing on this screen is estimated or inferred
 * (docs/08-ARCHITECTURE.md §11). Opening one leads to the same pass screen the
 * customer sees, because it is the same pass.
 */
export function MyStorePage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Your store"
        title="My Store"
        description="The Passes you have made. Publish one to put it in Discover."
        actions={
          <Button asChild>
            <Link to="/provider/passes/new">
              <Plus aria-hidden="true" />
              Create Pass
            </Link>
          </Button>
        }
      />
      <div className="mt-10">
        <ProviderAccountBoundary>
          <PublicPageRow />
          <StoreGrid />
          {/* What people bought, and the way into each one's sessions. */}
          <SoldPasses />
        </ProviderAccountBoundary>
      </div>
    </Page>
  )
}

/**
 * The provider's own public page, named and reachable.
 *
 * A provider had no way of finding out what their customers see, or what link
 * to send them — the storefront existed and nothing in the product pointed at
 * it. The URL is built from their stored slug, which is assigned once and never
 * changes, so the link here is the same one a customer already holds after a
 * rename (`src/lib/provider-url.ts`).
 *
 * Silent while the profile is still loading: a link with a provisional URL in
 * it is worse than a moment of nothing.
 */
function PublicPageRow() {
  const profile = useMyProviderProfile()
  if (!profile.data) return null

  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted/60 px-4 py-3">
      <p className="min-w-0 text-small text-ink-muted">
        Your public page ·{' '}
        <Link
          to={providerPath(profile.data)}
          className="break-all font-medium text-ink underline underline-offset-2"
        >
          /providers/{profile.data.slug}
        </Link>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <ShareButton url={providerUrl(profile.data)} copiedMessage="Provider link copied" />
        <Button asChild variant="ghost" size="sm">
          <Link to={providerPath(profile.data)}>
            <ExternalLink aria-hidden="true" />
            View
          </Link>
        </Button>
      </div>
    </div>
  )
}

function StoreGrid() {
  const catalog = useMyCatalogPasses()

  if (catalog.isPending) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <CreatedPassCardSkeleton key={index} />
        ))}
      </div>
    )
  }

  if (catalog.isError) {
    return <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
  }

  const items = catalog.data.items

  if (items.length === 0) {
    /*
     * No action here. The header's Create Pass is the one way in and it is
     * present whether or not the list has anything in it; repeating it inside
     * the card put two identical buttons a thumb apart on a phone, where the
     * header button sits directly above the empty state rather than beside it
     * (docs/03-DESIGN-SYSTEM.md §80 — one empty state, one action).
     */
    return (
      <EmptyState
        title="No passes yet"
        description="Create your first Pass and start accepting NIM."
      />
    )
  }

  return (
    <>
      <p className="mb-6 text-body text-ink-muted">{summaryLine(items)}</p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((pass) => (
          <CreatedPassCard key={pass.id} pass={pass} />
        ))}
      </div>
    </>
  )
}

/**
 * The line above the grid.
 *
 * Counts of the records the backend returned and the prices on them, and
 * nothing that would need a sales figure to be true.
 */
function summaryLine(items: Pass[]): string {
  const live = items.filter((pass) => pass.status === 'ACTIVE')
  const passWord = items.length === 1 ? 'Pass' : 'Passes'
  if (live.length === 0) return `${items.length} ${passWord} · none published yet`

  const cheapest = Math.min(...live.map((pass) => pass.priceLuna))
  return `${items.length} ${passWord} · ${live.length} published · from ${formatNim(cheapest)}`
}
