import type { AuthChallenge, AuthSession, SigningScheme, WalletSignature } from '@/types/auth'

import { apiRequest } from './client'

/**
 * Wallet authentication (`backend/openapi.yaml`, `/auth/*`).
 *
 * The backend owns the whole security model: it mints the nonce, binds the
 * challenge to a wallet, purpose, origin and expiry, verifies the signature,
 * derives the signer's address from the returned public key, and only then
 * issues a session (docs/09-SECURITY.md §13-§20).
 *
 * The frontend's entire contribution is carrying bytes between Nimiq Pay and
 * the backend. It never decides that authentication succeeded, and it never
 * reshapes what the wallet produced.
 */

/**
 * POST /auth/challenges → 201 `Challenge`
 *
 * Body is `ChallengeInput`: `{ wallet }` and nothing else — the schema is
 * `additionalProperties: false`, so an extra field is a 400. The purpose is
 * fixed by the endpoint (AUTH_LOGIN), not chosen by the client.
 *
 * The reply carries the exact `message` to sign. The client never composes or
 * edits it (§14).
 */
export function requestAuthChallenge(
  input: { wallet: string },
  options: { signal?: AbortSignal } = {},
): Promise<AuthChallenge> {
  return apiRequest<AuthChallenge>('/api/v1/auth/challenges', {
    method: 'POST',
    body: { wallet: input.wallet },
    signal: options.signal,
  })
}

/**
 * POST /auth/sessions → 201 `Session`, sets the session cookie.
 *
 * Body is `Proof`: `{ challengeId, wallet, publicKey, signature }`. The claimed
 * wallet proves nothing on its own — the backend derives the signer from
 * `publicKey` and requires it to match the challenge's wallet (§19).
 *
 * `publicKey` and `signature` are passed through byte-for-byte as the wallet
 * returned them. Nimpass does not re-encode, pad or normalise them: whether the
 * Mini App host's `sign()` output interoperates with the backend's Ed25519
 * verification is unverified against a real device, and quietly "fixing" the
 * encoding here would hide that rather than settle it.
 *
 * `signingScheme` is the one thing the client may say about *how* the bytes
 * were produced, and it is sent only when the transport documents its own
 * preprocessing — which today means the Nimiq Hub. Omitting it leaves the
 * backend on its configured `NIMIQ_SIGNING_SCHEME`, so the Mini App path is
 * byte-identical to before this field existed.
 */
export function verifyAuthSignature(
  input: {
    challengeId: string
    wallet: string
    signingScheme?: SigningScheme | null
  } & WalletSignature,
  options: { signal?: AbortSignal } = {},
): Promise<AuthSession> {
  return apiRequest<AuthSession>('/api/v1/auth/sessions', {
    method: 'POST',
    body: {
      challengeId: input.challengeId,
      wallet: input.wallet,
      publicKey: input.publicKey,
      signature: input.signature,
      ...(input.signingScheme ? { signingScheme: input.signingScheme } : {}),
    },
    signal: options.signal,
  })
}

/**
 * GET /auth/session → 200 `Session` | 401
 *
 * Recovers the session after a refresh, a navigation, or a return from the
 * Nimiq Pay approval sheet, and re-issues the CSRF token
 * (docs/09-SECURITY.md §61-§64).
 *
 * 401 is the ordinary answer for a visitor who is not signed in — the caller
 * treats it as "no session", not as an error to surface.
 */
export function getAuthSession(signal?: AbortSignal): Promise<AuthSession> {
  return apiRequest<AuthSession>('/api/v1/auth/session', { signal })
}

/** DELETE /auth/session → 204. Requires the CSRF header. */
export function logout(options: { signal?: AbortSignal } = {}): Promise<void> {
  return apiRequest<void>('/api/v1/auth/session', {
    method: 'DELETE',
    signal: options.signal,
  })
}
