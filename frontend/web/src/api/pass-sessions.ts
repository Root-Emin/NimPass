import type { PassSession, PassSessionList, PurchasedPass, SessionCompletion } from '@/types/domain'

import { apiRequest } from './client'

/**
 * Pass sessions (`backend/openapi.yaml`).
 *
 * The one thing to hold onto: there is a single set of session records per
 * pass, and both parties read and write *those*. The buyer's screen and the
 * provider's screen are two views of one row set, not two copies kept in step
 * — which is why nothing in this module caches a session, adjusts a counter,
 * or decides who may do what. Authorisation and the counters are the
 * backend's, resolved against the pass itself (docs/09-SECURITY.md §37).
 */

/**
 * GET /passes/{passID}/sessions → `PassSessionList`
 *
 * Every session of one pass, in order, for whichever party is asking.
 * `role` is the backend's statement of which party that is. An account that is
 * neither gets a 404 — knowing a pass id grants nothing.
 */
export function listPassSessions(passId: string, signal?: AbortSignal): Promise<PassSessionList> {
  return apiRequest<PassSessionList>(`/api/v1/passes/${encodeURIComponent(passId)}/sessions`, {
    signal,
  })
}

/**
 * PATCH /pass-sessions/{sessionID}/schedule → `PassSession`
 *
 * Either party may set a date; `scheduledAt: null` clears it and returns the
 * session to "Not scheduled". The field is always sent, never omitted: an
 * absent field is a malformed request rather than a silent unschedule, which
 * matters because clearing a date is a real thing a provider does.
 *
 * Scheduling never moves a counter. A date is not a delivery.
 */
export function scheduleSession(
  sessionId: string,
  scheduledAt: string | null,
  signal?: AbortSignal,
): Promise<PassSession> {
  return apiRequest<PassSession>(
    `/api/v1/pass-sessions/${encodeURIComponent(sessionId)}/schedule`,
    { method: 'PATCH', body: { scheduledAt }, signal },
  )
}

/**
 * POST /pass-sessions/{sessionID}/complete → `SessionCompletion`
 *
 * Records that a session was delivered. Provider-only: the owner's way to
 * spend a session is the wallet-signed redemption, where the signature is the
 * proof of intent (docs/DECISIONS.md ADR-007), and an owner calling this is
 * refused with 403.
 *
 * The response carries the pass as well as the session because the remaining
 * count moved in the same transaction — the caller renders the number the
 * backend wrote and never subtracts one locally.
 */
export function completeSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionCompletion> {
  return apiRequest<SessionCompletion>(
    `/api/v1/pass-sessions/${encodeURIComponent(sessionId)}/complete`,
    { method: 'POST', signal },
  )
}

/**
 * GET /providers/{providerID}/purchased-passes → the provider's sold passes
 *
 * The provider's side of the same records their customers hold. Scoped
 * server-side to the authenticated provider account.
 */
export function listProviderPurchasedPasses(
  providerId: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<{ items: PurchasedPass[] }> {
  return apiRequest<{ items: PurchasedPass[] }>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/purchased-passes`,
    { query: { limit: options.limit }, signal: options.signal },
  )
}
