import type { Pass } from '@/types/domain'

import { apiRequest } from './client'

/**
 * GET /passes/{passID} → `Pass`
 *
 * Ownership is enforced server-side from the authenticated wallet session; the
 * client never passes an owner id (docs/09-SECURITY.md §32, §36). A pass
 * belonging to someone else is a 404, not a filtered-out row.
 *
 * BACKEND CONTRACT STILL MISSING: there is no pass *list* endpoint. My Passes
 * therefore reaches its passes through the purchases that produced them — see
 * `hooks/use-passes.ts` for the limits that workaround carries.
 *
 * Session history is no longer missing: the backend shipped
 * `GET /passes/{passID}/redemptions` with Mission 04. Pass Detail does not read
 * it yet, because the rest of that contract is unwired (Milestone 4B).
 */
export function getPass(id: string, signal?: AbortSignal): Promise<Pass> {
  return apiRequest<Pass>(`/api/v1/passes/${encodeURIComponent(id)}`, { signal })
}
