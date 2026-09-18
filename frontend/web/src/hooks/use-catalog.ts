import { useQueries, useQuery } from '@tanstack/react-query'

import { catalogApi, providersApi, queryKeys } from '@/api'
import { toPassListing, type ClassifiedCategory, type PassListing } from '@/types/domain'

/**
 * Server-state hooks for the public catalogue.
 *
 * Remote state lives in the query cache and nowhere else; it is never copied
 * into component or global state where it could drift from the backend
 * (docs/08-ARCHITECTURE.md §78).
 *
 * Category filtering is the backend's: `GET /public/passes?category=` selects
 * server-side, so each filter is its own cached query rather than one list
 * narrowed on this side. Free-text search stays local, because the contract has
 * no search parameter — that split is deliberate and visible in the code.
 */

export function usePublicPasses(category?: ClassifiedCategory) {
  return useQuery({
    queryKey: queryKeys.catalog.list(category),
    queryFn: async ({ signal }) => {
      const page = await catalogApi.listPublicPasses(category ? { category } : {}, signal)
      return page.items.map(toPassListing)
    },
  })
}

/**
 * The canonical service taxonomy (`GET /public/categories`).
 *
 * Read from the backend rather than hard-coded, so a category the backend adds
 * appears in the filter without a frontend release — and a value the frontend
 * invented can never be sent, since only these are offered.
 */
export function useCategories() {
  return useQuery({
    queryKey: queryKeys.catalog.categories(),
    queryFn: async ({ signal }) => (await catalogApi.listCategories(signal)).items,
    // The taxonomy is controlled server-side and changes about as often as a
    // release does; refetching it per navigation would be noise.
    staleTime: 60 * 60 * 1000,
  })
}

export function usePublicPass(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.catalog.detail(id ?? ''),
    queryFn: async ({ signal }) => {
      const offer = await catalogApi.getPublicPass(id as string, signal)
      return toPassListing(offer)
    },
    enabled: Boolean(id),
  })
}

export function usePublicProvider(providerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.providers.detail(providerId ?? ''),
    queryFn: ({ signal }) => providersApi.getPublicProvider(providerId as string, signal),
    enabled: Boolean(providerId),
  })
}

/**
 * A public provider by its stable slug (`GET /public/providers/by-slug/{slug}`).
 *
 * The slug survives a rename, so this is what shared provider links resolve
 * through. A UUID in the path is rejected server-side, which is why the route
 * decides which of the two lookups to use rather than trying both.
 */
export function usePublicProviderBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.providers.bySlug(slug ?? ''),
    queryFn: ({ signal }) => providersApi.getPublicProviderBySlug(slug as string, signal),
    enabled: Boolean(slug),
  })
}

/**
 * Names for several providers at once.
 *
 * Passes no longer need this: each one carries `providerName` as a purchased
 * snapshot. `Purchase` does not, so the places that list purchases still have
 * to resolve names, and there is no batch route — this reads one cached record
 * per distinct id.
 *
 * A name that fails to load is simply absent. Every screen that uses this
 * renders without it (docs/08-ARCHITECTURE.md §11).
 */
export function usePublicProviders(providerIds: string[]): Record<string, string> {
  // Sorted and de-duplicated so the query list is stable across renders.
  const unique = Array.from(new Set(providerIds)).sort()

  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: queryKeys.providers.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        providersApi.getPublicProvider(id, signal),
    })),
  })

  const names: Record<string, string> = {}
  results.forEach((result, index) => {
    const id = unique[index]
    if (id && result.data?.name) names[id] = result.data.name
  })
  return names
}

/**
 * The whole public provider directory (`GET /public/providers`).
 *
 * The backend decides who is discoverable — a verified payout wallet and at
 * least one pass the public catalogue would list — and counts the passes. This
 * used to be assembled in the browser out of `GET /public/passes`, which meant
 * the directory quietly stopped at whoever appeared in the newest hundred
 * passes and the count was "how many of them were on this page".
 */
export function usePublicProviderDirectory() {
  return useQuery({
    queryKey: queryKeys.providers.directory(),
    queryFn: async ({ signal }) => (await providersApi.listPublicProviders(signal)).items,
  })
}

/**
 * The passes a provider has published (`GET /public/passes?provider=`).
 *
 * Server-side, for the same reason the category filter is: filtering the global
 * catalogue here would show only the passes that happened to be in the newest
 * hundred, and a storefront that silently omits half a provider's passes is
 * worse than a slower one.
 */
export function usePublicProviderPasses(providerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.providers.passes(providerId ?? ''),
    queryFn: async ({ signal }): Promise<PassListing[]> => {
      const page = await catalogApi.listPublicPasses({ provider: providerId }, signal)
      return page.items.map(toPassListing)
    },
    enabled: Boolean(providerId),
  })
}
