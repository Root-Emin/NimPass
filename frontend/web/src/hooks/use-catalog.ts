import { useQuery } from '@tanstack/react-query'

import { packagesApi, providersApi, queryKeys } from '@/api'
import { toPackageListing, type PackageListing } from '@/types/domain'

/**
 * Server-state hooks for the public catalogue.
 *
 * Remote state lives in the query cache and nowhere else; it is never copied
 * into component or global state where it could drift from the backend
 * (docs/08-ARCHITECTURE.md §78).
 *
 * `GET /public/packages` takes no parameters in the contract — no search, no
 * category, no cursor — so the whole published catalogue arrives in one
 * response and Discover narrows it locally. That is a deliberate,
 * clearly-bounded stand-in, not a filter the backend performed: when discovery
 * query parameters exist, the filtering moves server-side and this comment goes
 * with it. Reported as a contract gap.
 */

export function usePublicPackages() {
  return useQuery({
    queryKey: queryKeys.packages.list(),
    queryFn: async ({ signal }) => {
      const page = await packagesApi.listPublicPackages(signal)
      return page.items.map(toPackageListing)
    },
  })
}

export function usePublicPackage(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.packages.detail(id ?? ''),
    queryFn: async ({ signal }) => {
      const offer = await packagesApi.getPublicPackage(id as string, signal)
      return toPackageListing(offer)
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
 * The packages a provider has published.
 *
 * Derived from the public catalogue rather than fetched, because the contract
 * has no per-provider public package endpoint. The consequence is worth being
 * explicit about: a provider with nothing published cannot be listed this way,
 * and the page says the provider has no packages rather than pretending to know
 * more.
 */
export function usePublicProviderPackages(providerId: string | undefined) {
  const all = usePublicPackages()
  const items: PackageListing[] | undefined = providerId
    ? all.data?.filter((item) => item.provider.id === providerId)
    : undefined
  return { ...all, data: items }
}
