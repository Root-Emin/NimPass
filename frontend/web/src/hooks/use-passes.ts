import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { passesApi, queryKeys } from '@/api'
import { useSession } from '@/hooks/use-session'
import type { PurchasedPass, PurchasedPassStatusFilter } from '@/types/domain'

/**
 * Pass queries.
 *
 * Ownership is decided by the backend from the authenticated session — these
 * hooks never send an owner id and never filter by wallet client-side
 * (docs/09-SECURITY.md §32, §36).
 */

/**
 * The passes this customer owns (`GET /passes`).
 *
 * Ownership, ordering and expiry are all the backend's: the request carries no
 * wallet, the page arrives newest-first, and a pass that expired is already
 * reported as EXPIRED rather than being aged on this side.
 *
 * Paged with the contract's opaque cursor. The status filter is fixed for the
 * whole walk because the spec requires it — the cursor and the filter are one
 * pair, and mixing them mid-walk is undefined. `hasMore` is `nextCursor !== null`
 * and nothing else: a short page is not the end of the collection.
 */
export interface MyPasses {
  data: PurchasedPass[] | undefined
  isPending: boolean
  isError: boolean
  error: unknown
  hasMore: boolean
  isLoadingMore: boolean
  loadMore: () => void
  refetch: () => void
}

/** One page's worth. The contract's maximum is 100. */
const PASS_PAGE_SIZE = 20

export function useMyPasses(status: PurchasedPassStatusFilter = ''): MyPasses {
  const { session } = useSession()

  const query = useInfiniteQuery({
    queryKey: queryKeys.passes.mine(status),
    queryFn: ({ pageParam, signal }) =>
      passesApi.listPasses({ limit: PASS_PAGE_SIZE, status, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Passes are private. Without a session there is nobody to list them for,
    // and asking would be a guaranteed 401 (docs/09-SECURITY.md §32).
    enabled: Boolean(session),
  })

  return {
    data: query.data?.pages.flatMap((page) => page.items),
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
    },
    refetch: () => {
      void query.refetch()
    },
  }
}

/**
 * The live pass this customer already holds for one catalogue Pass, if any.
 *
 * Presentation only, like `isOwnListing`. The rule is
 * `POST /api/v1/purchases` answering 409 PASS_ALREADY_OWNED, decided against
 * `purchased_passes` under a lock; what this buys is that the customer sees the
 * pass they already have instead of a Buy button that cannot work.
 *
 * It reads the first page of their ACTIVE passes and nothing more — the list
 * endpoint has no filter by catalogue Pass, and walking every page to grey out
 * a button would be a request storm for a cosmetic answer. A customer holding
 * more ACTIVE passes than one page therefore still sees the button and is
 * answered by the backend, which is the same outcome the answer always had.
 */
export function useHeldPass(passId: string | undefined): PurchasedPass | undefined {
  const { data } = useMyPasses('ACTIVE')
  if (!passId) return undefined
  return data?.find((pass) => pass.passId === passId && pass.remainingSessions > 0)
}

export function usePass(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.passes.detail(id ?? ''),
    queryFn: ({ signal }) => passesApi.getPass(id as string, signal),
    enabled: Boolean(id),
  })
}
