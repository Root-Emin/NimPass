import type { PurchasedPass, PurchasedPassPage, PurchasedPassStatusFilter } from '@/types/domain'

import { apiRequest } from './client'

/**
 * GET /passes → `PurchasedPassPage`
 *
 * The customer's own passes, newest first, ownership decided server-side from
 * the session. Paged with an opaque cursor: the spec requires the same status
 * filter on every page of one walk, and warns that a concurrent redemption can
 * move a pass between status groups mid-walk — so a page is a snapshot, not a
 * transaction.
 *
 * Expiry is evaluated server-side *before* filtering, which is why an expired
 * pass never has to be recognised as expired on this side.
 */
export function listPasses(
  query: { limit?: number; status?: PurchasedPassStatusFilter; cursor?: string | null } = {},
  signal?: AbortSignal,
): Promise<PurchasedPassPage> {
  return apiRequest<PurchasedPassPage>('/api/v1/passes', {
    query: {
      limit: query.limit,
      // The empty status is a real value in the contract ("every status"), but
      // sending it is pointless: omitting the parameter means the same thing.
      status: query.status || undefined,
      cursor: query.cursor ?? undefined,
    },
    signal,
  })
}

/**
 * GET /passes/{passID} → `Pass`
 *
 * Ownership is enforced server-side from the authenticated wallet session; the
 * client never passes an owner id (docs/09-SECURITY.md §32, §36). A pass
 * belonging to someone else is a 404, not a filtered-out row.
 *
 * The pass carries its own purchased snapshots — service name, provider name
 * and price — so a pass screen needs no second request to name what was bought.
 */
export function getPass(id: string, signal?: AbortSignal): Promise<PurchasedPass> {
  return apiRequest<PurchasedPass>(`/api/v1/passes/${encodeURIComponent(id)}`, { signal })
}
