import type { PublicProvider } from '@/types/domain'

import { apiRequest } from './client'

/**
 * GET /public/providers/{providerID} → `PublicProvider`
 *
 * The public provider record is `{ id, name }`. That is the entire contract —
 * no headline, bio, avatar, cover image, location or service count exists
 * server-side, so the provider page renders identity plus the packages it can
 * fetch separately, and invents nothing (docs/08-ARCHITECTURE.md §11).
 *
 * BACKEND CONTRACT STILL MISSING: there is no public provider *list* endpoint
 * and no public per-provider package list. Discovery derives both from
 * `GET /public/packages`, which is honest but means a provider with no
 * published package is not discoverable at all.
 */
export function getPublicProvider(id: string, signal?: AbortSignal): Promise<PublicProvider> {
  return apiRequest<PublicProvider>(`/api/v1/public/providers/${encodeURIComponent(id)}`, {
    signal,
  })
}
