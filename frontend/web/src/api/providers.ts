import type { PublicProvider, PublicProviderSummary } from '@/types/domain'

import { apiRequest } from './client'

/**
 * GET /public/providers/{providerID} → `PublicProvider`
 *
 * Identity plus the public half of the profile: name, slug, headline, bio,
 * avatar, location, and the owner wallet used to render the identicon. Private
 * fields — payout wallet, verification, identity id — are not in this shape
 * at all.
 *
 */
export function getPublicProvider(id: string, signal?: AbortSignal): Promise<PublicProvider> {
  return apiRequest<PublicProvider>(`/api/v1/public/providers/${encodeURIComponent(id)}`, {
    signal,
  })
}

/**
 * GET /public/providers/by-slug/{slug} → `PublicProvider`
 *
 * The slug is assigned once and never changes, including across a rename, so a
 * link built on it keeps working. Shared provider URLs use this rather than the
 * UUID; the id lookup above stays for the places that already hold an id.
 */
export function getPublicProviderBySlug(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicProvider> {
  return apiRequest<PublicProvider>(
    `/api/v1/public/providers/by-slug/${encodeURIComponent(slug)}`,
    { signal },
  )
}

/**
 * GET /public/providers → `{ items: PublicProviderSummary[] }`
 *
 * The provider directory, decided server-side: every provider with a verified
 * payout wallet and at least one pass `GET /public/passes` would return, with
 * the count of those passes.
 *
 * Discover used to build this list in the browser out of the newest hundred
 * public passes, so a provider whose passes fell off that page vanished from
 * the directory. One endpoint, one rule, one answer.
 */
export function listPublicProviders(
  signal?: AbortSignal,
): Promise<{ items: PublicProviderSummary[] }> {
  return apiRequest<{ items: PublicProviderSummary[] }>('/api/v1/public/providers', { signal })
}
