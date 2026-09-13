import type { PublicOffer } from '@/types/domain'

import { apiRequest } from './client'

/**
 * Public discovery (`backend/openapi.yaml`, `/public/*`).
 *
 * Unauthenticated — `security: []` in the spec — because public browsing must
 * work with no wallet and no session (docs/02-USER-FLOWS.md §5).
 *
 * Both endpoints return `PublicOffer`: the package together with the provider
 * and service it belongs to.
 */

/**
 * GET /public/packages → `{ items: PublicOffer[] }`
 *
 * Published, unexpired packages only. The contract defines no query parameters:
 * there is no search, no category filter and no pagination cursor, so none are
 * sent. Discovery filters what it was given rather than pretending the backend
 * did (see the Milestone 3.6 report's contract gaps).
 */
export function listPublicPackages(signal?: AbortSignal): Promise<{ items: PublicOffer[] }> {
  return apiRequest<{ items: PublicOffer[] }>('/api/v1/public/packages', { signal })
}

/** GET /public/packages/{packageID} → `PublicOffer`. */
export function getPublicPackage(id: string, signal?: AbortSignal): Promise<PublicOffer> {
  return apiRequest<PublicOffer>(`/api/v1/public/packages/${encodeURIComponent(id)}`, { signal })
}
