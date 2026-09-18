import { useQueries } from '@tanstack/react-query'

import { catalogApi, queryKeys } from '@/api'
import { resolveCoverUrl } from '@/api/media'
import { toPassListing, type PurchasedPass } from '@/types/domain'

/**
 * The photograph a purchased pass was bought wearing.
 *
 * `PurchasedPass` carries the terms that were frozen at purchase — title,
 * service, provider, price, counts — and no artwork: `backend/openapi.yaml`
 * has no `coverUrl` on that schema (see the contract gap noted in
 * `lib/pass-cover.ts`). The catalog Pass it was bought from does, and the pass
 * carries its id, so the cover is read from `GET /public/passes/{passID}` —
 * the same endpoint, and the same cache entry, the public pass page uses.
 *
 * Deliberately one request per distinct pass rather than a scan of the public
 * catalogue: the catalogue is capped at the newest hundred published passes, so
 * a pass bought a while ago would silently lose its picture. This follows the
 * shape `usePublicProviders` already uses for the same problem — cached,
 * de-duplicated across every surface, and entirely optional.
 *
 * A pass whose catalog entry is gone (unpublished, archived, 404) simply has no
 * photograph, and every caller renders the accent field instead. Nothing here
 * is authoritative: it is artwork, never terms (docs/08-ARCHITECTURE.md §11).
 */
export function usePassCovers(passIds: string[]): Record<string, string> {
  const unique = Array.from(new Set(passIds.filter(Boolean))).sort()

  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: queryKeys.catalog.detail(id),
      // Mapped exactly as `usePublicPass` maps it: the two share this cache
      // entry, so they must agree on what is stored under it.
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        toPassListing(await catalogApi.getPublicPass(id, signal)),
      // Artwork changes about as often as a release does, and a missing cover
      // is not worth re-asking for on every navigation.
      staleTime: 10 * 60 * 1000,
    })),
  })

  const covers: Record<string, string> = {}
  results.forEach((result, index) => {
    const id = unique[index]
    const src = resolveCoverUrl(result.data?.coverUrl)
    if (id && src) covers[id] = src
  })
  return covers
}

/** The same lookup for a single pass. */
export function usePassCover(pass: Pick<PurchasedPass, 'passId'> | undefined): string | null {
  const covers = usePassCovers(pass ? [pass.passId] : [])
  return pass ? (covers[pass.passId] ?? null) : null
}
