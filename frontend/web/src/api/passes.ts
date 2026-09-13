import type { Pass } from '@/types/domain'

import { apiRequest } from './client'

/**
 * GET /passes/{passID} → `Pass`
 *
 * Ownership is enforced server-side from the authenticated wallet session; the
 * client never passes an owner id (docs/09-SECURITY.md §32, §36). A pass
 * belonging to someone else is a 404, not a filtered-out row.
 *
 * BACKEND CONTRACT STILL MISSING: there is no `GET /me/passes` list and no
 * session-history endpoint. `backend/openapi.yaml` defines this single lookup
 * and notes "no redemption in Mission 03", so My Passes reaches its passes
 * through the purchases that produced them, and history has no source at all.
 */
export function getPass(id: string, signal?: AbortSignal): Promise<Pass> {
  return apiRequest<Pass>(`/api/v1/passes/${encodeURIComponent(id)}`, { signal })
}
