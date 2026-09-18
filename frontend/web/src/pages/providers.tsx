import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Page, PageHeader } from '@/components/layout/page'
import { ProviderCard, ProviderCardSkeleton } from '@/components/provider/provider-card'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { usePublicProviderDirectory } from '@/hooks/use-catalog'
import type { PublicProviderSummary } from '@/types/domain'

/**
 * The provider directory (`/providers`).
 *
 * Discover shows a handful of providers as a preview; this is the whole list.
 * It comes from `GET /public/providers` in one request, so the page is the
 * backend's answer to "who is discoverable" rather than a by-product of which
 * passes happened to be on the catalogue's first page — which is what the
 * preview used to be built from, and why a provider could disappear from
 * Discover by having newer passes published around them.
 *
 * No pagination. The endpoint returns up to 200 providers in one page, which is
 * the whole directory at Nimpass's size, and inventing a cursor for a list the
 * contract does not page would be building a mechanism with nothing behind it
 * (docs/08-ARCHITECTURE.md §145).
 *
 * Search narrows what arrived, exactly as Discover's does and for the same
 * reason: the contract has no search parameter, and pretending otherwise would
 * be the frontend claiming an authority it does not have.
 */
export function ProvidersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const directory = usePublicProviderDirectory()

  const matches = useMemo(() => filterProviders(directory.data, query), [directory.data, query])

  const setQuery = (next: string) => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        if (next.trim()) params.set('q', next)
        else params.delete('q')
        return params
      },
      { replace: true },
    )
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Discover"
        title="Providers"
        description="Everyone selling session passes on Nimpass."
      />

      <div className="mt-8 sm:mt-10">
        <Directory
          state={directory}
          items={matches}
          query={query}
          onClearSearch={() => setQuery('')}
        />
      </div>
    </Page>
  )
}

function Directory({
  state,
  items,
  query,
  onClearSearch,
}: {
  state: ReturnType<typeof usePublicProviderDirectory>
  items: PublicProviderSummary[] | undefined
  query: string
  onClearSearch: () => void
}) {
  if (state.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <ProviderCardSkeleton key={index} />
        ))}
      </div>
    )
  }

  if (state.isError) {
    return <ErrorState error={state.error} onRetry={() => void state.refetch()} />
  }

  if (!items || items.length === 0) {
    return query ? (
      <EmptyState
        title="No providers matched"
        description={`Nothing here matches “${query}”. Try a shorter search term.`}
        action={
          <button
            type="button"
            onClick={onClearSearch}
            className="text-body text-accent underline underline-offset-2"
          >
            Show every provider
          </button>
        }
      />
    ) : (
      <EmptyState
        title="No providers yet"
        description="Providers appear here once they publish their first pass."
      />
    )
  }

  return (
    <>
      <p className="mb-5 text-body text-ink-muted">
        {items.length === 1 ? '1 provider' : `${items.length} providers`}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {items.map((item) => (
          <ProviderCard
            key={item.provider.id}
            provider={item.provider}
            passCount={item.passCount}
          />
        ))}
      </div>
    </>
  )
}

/** Narrows the directory on the fields the contract actually returns. */
function filterProviders(
  items: PublicProviderSummary[] | undefined,
  query: string,
): PublicProviderSummary[] | undefined {
  const term = query.trim().toLowerCase()
  if (!items || !term) return items
  return items.filter((item) =>
    [item.provider.name, item.provider.headline, item.provider.location]
      .join(' ')
      .toLowerCase()
      .includes(term),
  )
}
