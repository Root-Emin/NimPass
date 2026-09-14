import type {
  RedemptionChallenge,
  RedemptionConfirmation,
  RedemptionHistoryItem,
  RedemptionLookup,
} from '@/types/domain'

import { apiRequest } from './client'

/**
 * Session redemption (`backend/openapi.yaml`, Mission 04.1).
 *
 * The shape of this module is the security model in miniature. The customer
 * asks for a challenge, signs the server's exact message, and receives a
 * short-lived reference. The provider looks that reference up — which consumes
 * nothing — and then, separately and explicitly, confirms. Only that last call
 * moves a counter, and it moves it inside one database transaction.
 *
 * There is deliberately no endpoint that lets either side assert an outcome,
 * and nothing here composes a signing message, mints a reference, or decrements
 * a session (docs/08-ARCHITECTURE.md §49-§50, docs/09-SECURITY.md §48-§56).
 */

/* -- Customer ------------------------------------------------------------ */

/**
 * POST /passes/{passID}/redemption-challenges → 200 `RedemptionChallenge`
 *
 * Creates a five-minute challenge bound to the pass, its provider and this
 * customer. No request body: everything is derived server-side from the
 * authenticated session and the pass.
 *
 * It has two other jobs, both load-bearing:
 *
 *  - Called while a `CREATED` challenge already exists, it returns that one.
 *    One active challenge per pass is a database constraint, not a convention.
 *  - Called while an `AUTHORIZED` challenge exists, it **rotates** the NR1
 *    reference and returns the fresh one, invalidating the previous. This is
 *    the only documented way to recover a reference after a reload, since
 *    reading a challenge back never includes one — and it needs no second
 *    signature, because the challenge is already authorised.
 *
 * Creating or rotating never consumes a session.
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
 * The current challenge's state, **without** the bearer reference. Use it to
 * find out where a redemption stands after a reload; use the POST above when a
 * usable reference is actually needed.
 *
 * 404 simply means no active challenge — a normal answer, not an error.
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

/** GET /redemption-challenges/{challengeID} → 200. Also without the reference. */
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
 * This is the one call that makes a reference usable, and the response is the
 * only place besides a rotation where `redemptionReference` appears. It creates
 * no session effect: authorising is not redeeming.
 *
 * Not idempotent. Re-posting against an already-authorised challenge is a 409 —
 * to recover a reference, rotate through `createRedemptionChallenge`.
 */
export function authorizeRedemption(
  challengeId: string,
  input: { publicKey: string; signature: string },
  options: { signal?: AbortSignal } = {},
): Promise<RedemptionChallenge> {
  return apiRequest<RedemptionChallenge>(
    `/api/v1/redemption-challenges/${encodeURIComponent(challengeId)}/authorization`,
    {
      method: 'POST',
      // Forwarded byte-for-byte. Re-encoding, padding or case-folding either
      // value would sign different bytes than the wallet did.
      body: { publicKey: input.publicKey, signature: input.signature },
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

/**
 * POST /providers/{providerID}/redemptions/lookup → 200 `RedemptionLookup`
 *
 * **Non-consuming.** It validates the reference, expiry, authorisation, pass
 * binding, provider ownership and stale context, and returns just enough
 * context for a human to confirm deliberately. It creates no redemption and
 * moves no counter.
 *
 * A successful lookup is not a successful redemption, and the UI must never
 * present it as one (§18 of this milestone).
 */
export function lookupRedemption(
  providerId: string,
  input: { redemptionReference: string },
  options: { signal?: AbortSignal } = {},
): Promise<RedemptionLookup> {
  return apiRequest<RedemptionLookup>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/redemptions/lookup`,
    {
      method: 'POST',
      body: { redemptionReference: input.redemptionReference },
      signal: options.signal,
    },
  )
}

/**
 * POST /providers/{providerID}/redemptions/confirm → 200 `RedemptionConfirmationResult`
 *
 * The authoritative consumption. One session, one atomic transaction, one
 * redemption row — and the response carries the resulting counters, which is
 * where the new balance comes from. Never from arithmetic here.
 *
 * Replaying a consumed reference is a 409; the reference is single-use and the
 * backend enforces that, not this client.
 */
export function confirmRedemption(
  providerId: string,
  input: { redemptionReference: string },
  options: { signal?: AbortSignal } = {},
): Promise<RedemptionConfirmation> {
  return apiRequest<RedemptionConfirmation>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/redemptions/confirm`,
    {
      method: 'POST',
      body: { redemptionReference: input.redemptionReference },
      signal: options.signal,
    },
  )
}

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

/* -- Reference shape -----------------------------------------------------
 *
 * `NR1:` + 64 lowercase hex, as the contract's pattern says.
 *
 * This is presentation and paste-hygiene only. A reference that passes here is
 * not valid — validity is expiry, authorisation, ownership and single use, none
 * of which are visible in the string. It saves a round trip on an obvious typo
 * and nothing more (§37).
 * -------------------------------------------------------------------- */

export const REDEMPTION_REFERENCE_PATTERN = /^NR1:[0-9a-f]{64}$/

/** Trims and lowercases a pasted reference. Never repairs a malformed one. */
export function normaliseRedemptionReference(input: string): string {
  const trimmed = input.trim()
  return trimmed.startsWith('NR1:') ? `NR1:${trimmed.slice(4).toLowerCase()}` : trimmed
}

export function looksLikeRedemptionReference(input: string): boolean {
  return REDEMPTION_REFERENCE_PATTERN.test(normaliseRedemptionReference(input))
}
