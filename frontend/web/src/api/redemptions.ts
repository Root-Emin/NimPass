import type { Redemption, RedemptionChallenge } from '@/types/domain'
import type { ProviderPassView } from '@/types/redemption'

import { ApiError } from './errors'

/**
 * Session redemption — NOT IN THE CONTRACT YET.
 *
 * `backend/openapi.yaml` defines no redemption endpoints at all, and documents
 * `GET /passes/{passID}` as "no redemption in Mission 03". docs/08 §64 sketches
 * three conceptual routes, but a sketch in a design document is not a contract
 * the backend agreed to serve.
 *
 * So nothing here builds a URL. Every function rejects with the same
 * unavailable state the UI would show for a backend that cannot serve the call,
 * and the redemption screens — which are fully built — render honestly against
 * that today.
 *
 * This is deliberate over the alternative of guessing paths: a guessed route
 * fails at runtime against a real server and silently passes every test, while
 * this fails loudly and immediately, and `openapi-drift.test.ts` keeps it that
 * way. When Mission 04 defines the endpoints, each body becomes an `apiRequest`
 * call and no caller changes.
 */

function unavailable(operation: string): Promise<never> {
  return Promise.reject(
    new ApiError({
      code: 'REDEMPTION_UNAVAILABLE',
      message: 'Session redemption is not available yet.',
      details: { operation },
    }),
  )
}

/**
 * Create a short-lived challenge for a pass.
 *
 * Creating one must never consume a session (docs/09-SECURITY.md §48); its
 * lifetime, one-time-use flag and how many may be active at once are all the
 * backend's to decide (§49).
 */
export function createRedemptionChallenge(
  _passId: string,
  _options: { idempotencyKey: string; signal?: AbortSignal },
): Promise<RedemptionChallenge> {
  return unavailable('createRedemptionChallenge')
}

/**
 * Carry the pass owner's signature over the server-issued challenge message.
 *
 * A cryptographically valid signature is still rejected if the challenge was
 * consumed, expired, or belongs to another provider (docs/09-SECURITY.md §53).
 */
export function authorizeRedemption(
  _redemptionId: string,
  _input: { signature: string; publicKey: string },
  _options: { idempotencyKey: string; signal?: AbortSignal },
): Promise<Redemption> {
  return unavailable('authorizeRedemption')
}

/**
 * The provider-side confirmation that consumes exactly one session.
 *
 * The decrement happens atomically in the backend; the client only reads the
 * resulting balance back (docs/08-ARCHITECTURE.md §49-§50).
 */
export function completeRedemption(
  _redemptionId: string,
  _options: { idempotencyKey: string; signal?: AbortSignal },
): Promise<Redemption> {
  return unavailable('completeRedemption')
}

/** Resolve a scanned or typed challenge reference to the pass it belongs to. */
export function lookupRedemptionChallenge(
  _reference: string,
  _options: { signal?: AbortSignal } = {},
): Promise<{ redemptionId: string; pass: ProviderPassView }> {
  return unavailable('lookupRedemptionChallenge')
}
