import type { ClassifiedCategory, PublicPass } from '@/types/domain'

import { apiRequest } from './client'

/**
 * Public discovery (`backend/openapi.yaml`, `/public/*`).
 *
 * Unauthenticated — `security: []` in the spec — because public browsing must
 * work with no wallet and no session (docs/02-USER-FLOWS.md §5).
 *
 * Both endpoints return `PublicPass`: the pass together with the provider
 * and service it belongs to.
 */

/**
 * GET /public/passes → `{ items: PublicPass[] }`
 *
 * Published, unexpired passes only, up to 100, newest first. The one
 * parameter the contract defines is `category`, inherited from the service;
 * omitting it means every category *including* unclassified services, which is
 * why "All" sends nothing rather than sending `''`. An unknown or repeated
 * value is a VALIDATION_ERROR, so only the taxonomy's own values are ever sent.
 *
 * `provider` narrows the same list to one storefront. It is a server-side
 * filter for the same reason `category` is: a provider page built by filtering
 * the global catalogue in the browser shows only the passes that made it into
 * the newest hundred.
 *
 * Free-text search is still client-side: the contract has no search parameter,
 * and Discover narrows the page it was given rather than pretending otherwise.
 */
export function listPublicPasses(
  query: { category?: ClassifiedCategory; provider?: string } = {},
  signal?: AbortSignal,
): Promise<{ items: PublicPass[] }> {
  return apiRequest<{ items: PublicPass[] }>('/api/v1/public/passes', {
    query: { category: query.category, provider: query.provider },
    signal,
  })
}

/**
 * GET /public/categories → `{ items: ClassifiedCategory[] }`
 *
 * The canonical taxonomy, from the backend rather than a copy of it. The
 * unclassified empty value is excluded server-side, so every value returned is
 * one a filter can legitimately send.
 */
export function listCategories(signal?: AbortSignal): Promise<{ items: ClassifiedCategory[] }> {
  return apiRequest<{ items: ClassifiedCategory[] }>('/api/v1/public/categories', { signal })
}

/** GET /public/passes/{passID} → `PublicPass`. */
export function getPublicPass(id: string, signal?: AbortSignal): Promise<PublicPass> {
  return apiRequest<PublicPass>(`/api/v1/public/passes/${encodeURIComponent(id)}`, { signal })
}
