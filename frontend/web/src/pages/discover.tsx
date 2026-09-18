import { ArrowRight, Search, X } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { Page, Section, SectionHeader } from '@/components/layout/page'
import { PassGrid } from '@/components/catalog/pass-grid'
import { ProviderCard, ProviderCardSkeleton } from '@/components/provider/provider-card'
import { Button } from '@/components/ui/button'
import { FilterPills } from '@/components/ui/filter-pills'
import { EmptyState } from '@/components/ui/states'
import { useCategories, usePublicPasses, usePublicProviderDirectory } from '@/hooks/use-catalog'
import type { ClassifiedCategory, PassListing, PublicProviderSummary } from '@/types/domain'

/**
 * The main public surface (docs/03-DESIGN-SYSTEM.md §39).
 *
 * Closer to Luma Discover than to a large marketplace: a short statement of
 * what Nimpass is, light search, then curated content. Works with no wallet
 * connected (docs/02-USER-FLOWS.md §5).
 *
 * Two filters, drawn from two different places on purpose:
 *
 *  - Category is the backend's. `GET /public/categories` supplies the taxonomy
 *    and `GET /public/passes?category=` does the selecting, so each filter is
 *    a separate server answer rather than one list sliced here. Only values the
 *    backend returned are ever sent — an unknown one is a VALIDATION_ERROR, and
 *    inventing categories is what the previous version of this page did wrong.
 *  - Search is not. The contract has no search parameter, so the term narrows
 *    the page that arrived. Correct while the catalogue is capped at 100 and
 *    honest about being a client-side narrowing.
 *
 * Both live in the URL, so a filtered view survives a refresh and stays
 * shareable (docs/08-ARCHITECTURE.md §80).
 */
export function DiscoverPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''

  const categories = useCategories()
  // An unrecognised `?category=` is dropped rather than forwarded: the URL is
  // user input, and the request must only ever carry taxonomy values.
  const requested = searchParams.get('category') ?? ''
  const category = categories.data?.includes(requested as ClassifiedCategory)
    ? (requested as ClassifiedCategory)
    : undefined

  const passes = usePublicPasses(category)
  // The directory is its own server answer rather than a by-product of the
  // passes above, so this preview can no longer be silently truncated by which
  // passes happened to be in the newest hundred. The full list lives at
  // `/providers`; here it is the first few.
  const directory = usePublicProviderDirectory()

  const matches = useMemo(() => filterPasses(passes.data, query), [passes.data, query])
  const providers = useMemo(
    () => previewProviders(directory.data, matches, query, Boolean(category)),
    [directory.data, matches, query, category],
  )

  const setParam = (key: 'q' | 'category', next: string) => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        if (next.trim()) params.set(key, next)
        else params.delete(key)
        return params
      },
      { replace: true },
    )
  }

  const setQuery = (next: string) => setParam('q', next)
  const filtered = Boolean(query) || Boolean(category)

  /** Back to the unfiltered catalogue: both filters drop out of the URL too. */
  const clearFilters = () => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        params.delete('q')
        params.delete('category')
        return params
      },
      { replace: true },
    )
  }

  return (
    <>
      <section className="bg-canvas-sunken/60">
        <Container className="py-14 sm:py-18">
          <p className="eyebrow text-accent">Discover</p>
          <h1 className="mt-4 max-w-3xl text-h1 text-ink">Passes worth coming back to.</h1>
          <p className="mt-5 max-w-2xl text-pretty text-lead text-ink-muted">
            Buy prepaid sessions from independent professionals, pay in NIM, and keep every
            visit on one simple digital pass.
          </p>

          <form
            role="search"
            className="mt-9 max-w-lg"
            onSubmit={(event) => event.preventDefault()}
          >
            <label htmlFor="discover-search" className="sr-only">
              Search passes or providers
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
                aria-hidden="true"
              />
              <input
                id="discover-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search passes or providers…"
                className="h-13 w-full rounded-full border border-line bg-surface pl-11 pr-14 text-body text-ink shadow-soft transition-colors placeholder:text-ink-subtle hover:border-line-strong focus:border-accent-border"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink sm:size-9"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </form>

          {/* Only rendered once the taxonomy has arrived: a filter row that
              appears empty and then fills in is worse than one that waits. */}
          {categories.data && categories.data.length > 0 ? (
            <FilterPills
              className="mt-6"
              label="Filter by category"
              value={category ?? ''}
              onChange={(next) => setParam('category', next)}
              options={[
                { value: '', label: 'All' },
                ...categories.data.map((value) => ({ value, label: categoryLabel(value) })),
              ]}
            />
          ) : null}
        </Container>
      </section>

      <Page className="pt-8 sm:pt-10">
        <Section flush>
          <SectionHeader
            title={filtered ? 'Results' : 'Popular passes'}
            description={
              filtered ? undefined : 'Multi-session passes you can buy with NIM today.'
            }
            action={
              filtered ? (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Show all passes
                </Button>
              ) : undefined
            }
          />

          <PassGrid
            items={matches}
            isPending={passes.isPending}
            error={passes.isError ? passes.error : null}
            onRetry={() => void passes.refetch()}
            emptyTitle={filtered ? 'Nothing matched' : 'No passes yet'}
            emptyDescription={
              filtered
                ? 'Try another category, or a different service or provider name.'
                : 'New session passes will show up here as providers publish them.'
            }
            emptyAction={
              filtered ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Show all passes
                </Button>
              ) : undefined
            }
          />
        </Section>

        {/*
          A preview of the directory, not the directory. `GET /public/providers`
          decides who is discoverable and counts their passes; this shows the
          first few and hands the rest to `/providers`, which is the page that
          exists to list everyone (docs/08-ARCHITECTURE.md §80).

          While a filter is on, the preview follows the filter instead — those
          are the providers whose passes are actually on screen — because a
          directory slice that ignores the filter beside filtered results reads
          as a bug.
        */}
        <Section>
          <SectionHeader
            title="Explore providers"
            description={
              query
                ? `Providers matching \u201c${query}\u201d`
                : category
                  ? `Providers publishing ${categoryLabel(category).toLowerCase()} passes.`
                  : 'People selling sessions on Nimpass.'
            }
          />

          {directory.isPending && !filtered ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <ProviderCardSkeleton key={index} />
              ))}
            </div>
          ) : providers.length === 0 ? (
            <EmptyState
              title={filtered ? 'No providers matched' : 'No providers yet'}
              description={query ? 'Try a shorter search term.' : undefined}
            />
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {providers.map(({ provider, passCount }) => (
                  <ProviderCard key={provider.id} provider={provider} passCount={passCount} />
                ))}
              </div>
              {/* One CTA, at the end of the row — where a reader who has just
                  finished the preview actually is. It is deliberately not also
                  in the section header: at 375px a heading and an action on one
                  line leave neither enough room. */}
              <div className="mt-6 flex justify-center sm:justify-end">
                <Button asChild variant="secondary" size="sm">
                  <Link to="/providers">
                    See all providers
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </>
          )}
        </Section>

        <Section className="rounded-3xl bg-surface-muted px-6 py-12 sm:px-12">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-lg space-y-2">
              <h2 className="text-h3 text-ink">Do you sell sessions?</h2>
              <p className="text-body-lg text-ink-muted">
                Publish a pass and get paid in NIM, straight to your own wallet.
              </p>
            </div>
            <Button asChild variant="secondary" className="shrink-0">
              <Link to="/provider/passes/new">Create a Pass</Link>
            </Button>
          </div>
        </Section>
      </Page>
    </>
  )
}

/** `fitness` → `Fitness`. The taxonomy is lowercase on the wire. */
function categoryLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Narrows the published catalogue on the fields the contract actually returns. */
function filterPasses(
  items: PassListing[] | undefined,
  query: string,
): PassListing[] | undefined {
  const term = query.trim().toLowerCase()
  if (!items || !term) return items
  return items.filter((item) =>
    [item.title, item.description, item.provider.name, item.service.name]
      .join(' ')
      .toLowerCase()
      .includes(term),
  )
}

/** How many providers the Discover preview shows before "See all". */
const PROVIDER_PREVIEW = 6

/**
 * The providers to preview on Discover.
 *
 * Unfiltered, this is the head of the backend's directory — the same list and
 * the same counts `/providers` shows, cut short.
 *
 * Filtered, it is the providers behind the passes currently on screen, because
 * the contract has no filtered directory and showing unrelated providers next
 * to filtered results would be worse than showing fewer. The counts then
 * describe the filtered passes, which is what the reader is looking at.
 */
function previewProviders(
  directory: PublicProviderSummary[] | undefined,
  matches: PassListing[] | undefined,
  query: string,
  hasCategory: boolean,
): PublicProviderSummary[] {
  if (query.trim() || hasCategory) {
    return providersOfPasses(matches).slice(0, PROVIDER_PREVIEW)
  }
  return (directory ?? []).slice(0, PROVIDER_PREVIEW)
}

/** The distinct providers behind a set of passes, with how many are shown. */
function providersOfPasses(items: PassListing[] | undefined): PublicProviderSummary[] {
  const byId = new Map<string, PublicProviderSummary>()
  for (const item of items ?? []) {
    const existing = byId.get(item.provider.id)
    if (existing) existing.passCount += 1
    else byId.set(item.provider.id, { provider: item.provider, passCount: 1 })
  }
  return Array.from(byId.values())
}
