import { useQuery } from '@tanstack/react-query'

import { passesApi, purchasesApi, queryKeys } from '@/api'
import { useSession } from '@/hooks/use-session'

/**
 * Pass queries.
 *
 * Ownership is decided by the backend from the authenticated session — these
 * hooks never send an owner id and never filter by wallet client-side
 * (docs/09-SECURITY.md §32, §36).
 */

/**
 * The passes this customer owns.
 *
 * There is no `GET /me/passes` in the contract, so the list is assembled from
 * the purchases that produced the passes: `GET /purchases` returns up to 100
 * of the customer's own purchases, each carrying the `passId` it created.
 *
 * This is a real limitation, not a workaround to forget about. A customer with
 * more than 100 purchases would not see their oldest passes, and the ordering
 * is the purchase's, not the pass's. A pass list endpoint should replace this.
 */
export function useMyPasses() {
  const { session } = useSession()

  return useQuery({
    queryKey: queryKeys.passes.mine(),
    queryFn: async ({ signal }) => {
      const purchases = await purchasesApi.listMyPurchases(signal)
      const passIds = purchases.items
        .map((purchase) => purchase.passId)
        .filter((id): id is string => id !== null)

      // Fetched individually because that is the only pass endpoint there is.
      // `allSettled`: one unreadable pass must not blank the whole collection.
      const results = await Promise.allSettled(
        passIds.map((id) => passesApi.getPass(id, signal)),
      )
      return results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
    },
    // Asking without a session would only return 401.
    enabled: Boolean(session),
  })
}

export function usePass(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.passes.detail(id ?? ''),
    queryFn: ({ signal }) => passesApi.getPass(id as string, signal),
    enabled: Boolean(id),
  })
}
