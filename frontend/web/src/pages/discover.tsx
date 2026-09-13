import { Search, X } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { Page, Section, SectionHeader } from '@/components/layout/page'
import { PackageGrid } from '@/components/package/package-grid'
import { ProviderCard } from '@/components/provider/provider-card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'
import { usePublicPackages } from '@/hooks/use-catalog'
import type { PackageListing, PublicProvider } from '@/types/domain'

/**
 * The main public surface (docs/03-DESIGN-SYSTEM.md §39).
 *
 * Closer to Luma Discover than to a large marketplace: a short statement of
 * what Nimpass is, light search, then curated content. Works with no wallet
 * connected (docs/02-USER-FLOWS.md §5).
 *
 * `GET /public/packages` accepts no query parameters, so searching narrows the
 * published catalogue in the browser. That is a deliberate limit of the current
 * contract, not a pretence that the backend searched: it is correct while the
 * catalogue is small and needs a server-side query when it is not.
 *
 * The category filter that used to sit here is gone. `category` was never a
 * backend field — it existed only in the frontend — so filtering by it was
 * sorting packages by an attribute the domain does not have.
 *
 * The search term lives in the URL, so a filtered view survives a refresh and
 * stays shareable (docs/08-ARCHITECTURE.md §80).
 */
export function DiscoverPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''

  const packages = usePublicPackages()

  const matches = useMemo(
    () => filterPackages(packages.data, query),
    [packages.data, query],
  )
  const providers = useMemo(() => uniqueProviders(matches), [matches])

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
    <>
      <section className="border-b border-line/60 bg-canvas-sunken/50">
        <Container className="py-12 sm:py-16">
          <h1 className="max-w-2xl text-h1 leading-[1.1] tracking-[-0.025em] text-ink sm:text-[2.75rem]">
            Services worth coming back to.
          </h1>
          <p className="mt-4 max-w-xl text-body-lg text-ink-muted">
            Buy prepaid sessions from independent professionals, pay in NIM, and keep every
            visit on one simple digital pass.
          </p>

          <form role="search" className="mt-8 max-w-md" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="discover-search" className="sr-only">
              Search services or providers
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
                aria-hidden="true"
              />
              <input
                id="discover-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search services or providers…"
                className="h-12 w-full rounded-md border border-line bg-surface pl-10 pr-10 text-body text-ink transition-colors placeholder:text-ink-subtle hover:border-line-strong focus:border-accent-border"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </form>
        </Container>
      </section>

      <Page className="pt-10 sm:pt-12">
        <Section className="mt-0">
          <SectionHeader
            title={query ? 'Results' : 'Popular services'}
            description={query ? undefined : 'Multi-session packages you can buy with NIM today.'}
            action={
              query ? (
                <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                  Show all packages
                </Button>
              ) : undefined
            }
          />

          <PackageGrid
            items={matches}
            isPending={packages.isPending}
            error={packages.isError ? packages.error : null}
            onRetry={() => void packages.refetch()}
            emptyTitle={query ? 'Nothing matched your search' : 'No packages yet'}
            emptyDescription={
              query
                ? 'Try a different service or provider name.'
                : 'New session packages will show up here as providers publish them.'
            }
            emptyAction={
              query ? (
                <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                  Show all packages
                </Button>
              ) : undefined
            }
          />
        </Section>

        {/*
          Providers are derived from the packages above, because the contract has
          no public provider list. A provider with nothing published is therefore
          not discoverable — a real gap, and better than inventing a directory.
        */}
        {!packages.isError && !packages.isPending ? (
          <Section>
            <SectionHeader
              title="Explore providers"
              description={
                query ? `Providers matching “${query}”` : 'People selling sessions on Nimpass.'
              }
            />

            {providers.length === 0 ? (
              <EmptyState
                title={query ? 'No providers matched' : 'No providers yet'}
                description={query ? 'Try a shorter search term.' : undefined}
              />
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {providers.map(({ provider, packageCount }) => (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    packageCount={packageCount}
                  />
                ))}
              </div>
            )}
          </Section>
        ) : null}

        <Section className="border-t border-line pt-10">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-h3 text-ink">Do you sell sessions?</h2>
              <p className="mt-1 text-body text-ink-muted">
                Publish a package and get paid in NIM, straight to your own wallet.
              </p>
            </div>
            <Button asChild variant="secondary">
              <Link to="/provider">Open provider workspace</Link>
            </Button>
          </div>
        </Section>
      </Page>
    </>
  )
}

/** Narrows the published catalogue on the fields the contract actually returns. */
function filterPackages(
  items: PackageListing[] | undefined,
  query: string,
): PackageListing[] | undefined {
  const term = query.trim().toLowerCase()
  if (!items || !term) return items
  return items.filter((item) =>
    [item.title, item.description, item.provider.name, item.service.name]
      .join(' ')
      .toLowerCase()
      .includes(term),
  )
}

function uniqueProviders(
  items: PackageListing[] | undefined,
): { provider: PublicProvider; packageCount: number }[] {
  const byId = new Map<string, { provider: PublicProvider; packageCount: number }>()
  for (const item of items ?? []) {
    const existing = byId.get(item.provider.id)
    if (existing) existing.packageCount += 1
    else byId.set(item.provider.id, { provider: item.provider, packageCount: 1 })
  }
  return Array.from(byId.values())
}
