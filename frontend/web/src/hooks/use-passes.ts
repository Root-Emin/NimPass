import { useQuery } from '@tanstack/react-query'

import { passesApi, queryKeys, redemptionsApi } from '@/api'
import { useMyPurchases } from '@/hooks/use-purchases'

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
  // Shares the cached purchase list with the purchase-status surface rather
  // than fetching `/purchases` twice for one screen.
  const purchases = useMyPurchases()
  const passIds = (purchases.data ?? [])
    .map((purchase) => purchase.passId)
    .filter((id): id is string => id !== null)

  const passes = useQuery({
    queryKey: [...queryKeys.passes.mine(), passIds],
    queryFn: async ({ signal }) => {
      // Fetched individually because that is the only pass endpoint there is.
      // `allSettled`: one unreadable pass must not blank the whole collection.
      // A pass that 404s or 403s is dropped rather than rendered as an error —
      // ownership is the backend's answer, and the honest response to "not
      // yours" is to show what is (docs/09-SECURITY.md §32, §36).
      const results = await Promise.allSettled(passIds.map((id) => passesApi.getPass(id, signal)))
      return results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
    },
    // Nothing to resolve until the purchase list has arrived.
    enabled: purchases.isSuccess,
  })

  // The purchase list is the first hop, so its pending and error states are
  // this hook's too — otherwise a failed `/purchases` would render as an empty
  // pass collection, which reads as "you own nothing".
  return {
    data: passes.data,
    isPending: purchases.isPending || (purchases.isSuccess && passes.isPending),
    isError: purchases.isError || passes.isError,
    error: purchases.error ?? passes.error,
    refetch: () => {
      void purchases.refetch()
      return passes.refetch()
    },
  }
}

export function usePass(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.passes.detail(id ?? ''),
    queryFn: ({ signal }) => passesApi.getPass(id as string, signal),
    enabled: Boolean(id),
  })
}

/**
 * One pass's consumed-session history (`GET /passes/{passID}/redemptions`).
 *
 * Only consumed rows exist — a challenge that expired or was never authorised
 * leaves no trace here, which is correct: nothing happened. `sessionOrdinal` is
 * the backend's 1-based position in the pass's sequence, so the list never
 * needs to be counted or renumbered on this side.
 */
export function usePassRedemptions(passId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.redemptions.pass(passId ?? ''),
    queryFn: ({ signal }) => redemptionsApi.listPassRedemptions(passId as string, { signal }),
    enabled: Boolean(passId),
    select: (response) => response.items,
  })
}
