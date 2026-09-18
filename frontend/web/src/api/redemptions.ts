import type { RedemptionChallenge, RedemptionHistoryItem } from '@/types/domain'
import type { SigningScheme } from '@/types/auth'

import { apiRequest } from './client'

/**
 * Session redemption (`backend/openapi.yaml`).
 *
 * Two calls, and the security model is in the shape of them. The owner asks for
 * a challenge, then signs the server's exact message; that signature both
 * authorises and spends one session, in one backend transaction. There is no
 * bearer reference in between and no second party, because a pass is used by
 * the person who owns it (docs/01-PRODUCT.md §24-§25).
 *
 * Nothing here composes a signing message or decrements a session. A session is
 * used when the backend says it was, and the new counts come from its response
 * (docs/08-ARCHITECTURE.md §49-§50, docs/09-SECURITY.md §48-§56).
 */

/**
 * POST /passes/{passID}/redemption-challenges → 200 `RedemptionChallenge`
 *
 * Creates a five-minute challenge bound to the pass, its provider and this
 * customer. No request body: everything is derived server-side from the
 * authenticated session and the pass.
 *
 * Called while a challenge already exists, it returns that same one: one active
 * challenge per pass is a database constraint, not a convention. So this is
 * safe to call on entering the flow and again after a reload.
 *
 * Creating a challenge never consumes a session.
 */
export function createRedemptionChallenge(
  passId: string,
  options: { signal?: AbortSignal } = {},
): Promise<RedemptionChallenge> {
  return apiRequest<RedemptionChallenge>(
    `/api/v1/passes/${encodeURIComponent(passId)}/redemption-challenges`,
    { method: 'POST', signal: options.signal },
  )
}

/**
 * GET /passes/{passID}/redemption-challenges/current → 200 `RedemptionChallenge`
 *
 * Where a redemption stands after a reload. 404 simply means no active
 * challenge — a normal answer, not an error.
 */
export function getCurrentRedemptionChallenge(
  passId: string,
  options: { signal?: AbortSignal } = {},
): Promise<RedemptionChallenge> {
  return apiRequest<RedemptionChallenge>(
    `/api/v1/passes/${encodeURIComponent(passId)}/redemption-challenges/current`,
    { signal: options.signal },
  )
}

/** GET /redemption-challenges/{challengeID} → 200. One challenge's state. */
export function getRedemptionChallenge(
  challengeId: string,
  options: { signal?: AbortSignal } = {},
): Promise<RedemptionChallenge> {
  return apiRequest<RedemptionChallenge>(
    `/api/v1/redemption-challenges/${encodeURIComponent(challengeId)}`,
    { signal: options.signal },
  )
}

/**
 * POST /redemption-challenges/{challengeID}/authorization → 200
 *
 * Body is `RedemptionAuthorization`: `{ publicKey, signature }`, exactly the
 * two values Nimiq Pay's `sign()` returned, forwarded unchanged.
 *
 * This is the redemption. On success the backend has verified the signature and
 * consumed exactly one session in the same transaction, and the response
 * carries the resulting `pass` counts and the `redemption` that was recorded.
 *
 * Not idempotent, and deliberately so: a replayed authorization is refused
 * rather than silently spending a second session. A double-tapped button
 * therefore costs nothing.
 */
export function authorizeRedemption(
  challengeId: string,
  input: { publicKey: string; signature: string; signingScheme?: SigningScheme | null },
  options: { signal?: AbortSignal } = {},
): Promise<RedemptionChallenge> {
  return apiRequest<RedemptionChallenge>(
    `/api/v1/redemption-challenges/${encodeURIComponent(challengeId)}/authorization`,
    {
      method: 'POST',
      // Forwarded byte-for-byte. Re-encoding, padding or case-folding either
      // value would sign different bytes than the wallet did.
      //
      // `signingScheme` says which documented preprocessing produced them, and
      // is sent only by a transport that documents one — the Nimiq Hub. Omitted,
      // the backend verifies under its configured default, exactly as before.
      body: {
        publicKey: input.publicKey,
        signature: input.signature,
        ...(input.signingScheme ? { signingScheme: input.signingScheme } : {}),
      },
      signal: options.signal,
    },
  )
}

/** GET /passes/{passID}/redemptions → `{ items }`. The customer's own history. */
export function listPassRedemptions(
  passId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ items: RedemptionHistoryItem[] }> {
  return apiRequest<{ items: RedemptionHistoryItem[] }>(
    `/api/v1/passes/${encodeURIComponent(passId)}/redemptions`,
    { signal: options.signal },
  )
}

/* -- Provider ------------------------------------------------------------ */

/*
 * The provider has no write path into a redemption. There used to be a lookup
 * and a confirm here, and the confirm was where a session was actually spent;
 * both are gone from the contract. What remains is history: whose service was
 * consumed is still a fact the provider can read.
 */

/** GET /providers/{providerID}/redemptions → `{ items }`. Owned-provider history. */
export function listProviderRedemptions(
  providerId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ items: RedemptionHistoryItem[] }> {
  return apiRequest<{ items: RedemptionHistoryItem[] }>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/redemptions`,
    { signal: options.signal },
  )
}
