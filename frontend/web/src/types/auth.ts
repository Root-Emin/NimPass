/**
 * Nimpass wallet authentication.
 *
 * This is a Nimpass business/security flow built *on top of* the Nimiq
 * provider, not a Nimiq feature. Nimiq Pay supplies one thing — a signature
 * over a message, with a native confirmation. Everything that gives the
 * signature meaning (the nonce, the purpose, the binding, the expiry, the
 * verification and the resulting session) belongs to the backend
 * (docs/09-SECURITY.md §12-§20).
 */

/**
 * Signature purposes, kept apart so a signature taken for one can never be
 * replayed as another (docs/09-SECURITY.md §15, §20).
 *
 * The frontend never composes the signed text: the backend issues the exact
 * message and reconstructs it during verification (§14, §18). These constants
 * exist so the client can *request* the right kind of challenge and explain to
 * the user what they are approving.
 */
export const SIGNATURE_PURPOSES = {
  AUTH_LOGIN: 'AUTH_LOGIN',
  VERIFY_PROVIDER_WALLET: 'VERIFY_PROVIDER_WALLET',
} as const

export type SignaturePurpose = (typeof SIGNATURE_PURPOSES)[keyof typeof SIGNATURE_PURPOSES]

/**
 * A server-issued challenge (`Challenge` in `backend/openapi.yaml`).
 *
 * The spec is explicit about `message`: "Sign this exact UTF-8 string; do not
 * reconstruct it." The frontend never composes or normalises it (docs/09 §14).
 */
export interface AuthChallenge {
  id: string
  purpose: SignaturePurpose
  wallet: string
  message: string
  expiresAt: string
}

/**
 * What `sign()` returns, per the official Nimiq Provider API:
 * `{ publicKey: string, signature: string }` — hex strings.
 * Ref: https://nimiq.dev/mini-apps/api-reference/nimiq-provider
 */
export interface WalletSignature {
  publicKey: string
  signature: string
}

/** The authenticated identity (`Identity`). */
export interface AuthIdentity {
  id: string
  wallet: string
  createdAt: string
}

/**
 * An authenticated Nimpass session (`Session`).
 *
 * Distinct from wallet account access: Nimiq Pay revealing an address does not
 * make it an authenticated Nimpass identity (docs/09-SECURITY.md §11, §19).
 *
 * It carries identity and nothing else. There is no `isProvider` or
 * `providerId` in the contract, and there should not be: which providers an
 * identity may act for is a separate authorisation question, answered by
 * `GET /providers` (docs/09-SECURITY.md §67-§68).
 */
export interface AuthSession {
  identity: AuthIdentity
  expiresAt: string
  /**
   * Double-submit CSRF token, required on every authenticated unsafe request.
   * The session itself stays in an httpOnly cookie the client cannot read.
   */
  csrfToken: string
}

/** Where the sign-in flow currently is. Each step is separately renderable. */
export type AuthFlowState =
  | { kind: 'IDLE' }
  /** Asking Nimiq Pay which account to use — opens a native dialog. */
  | { kind: 'REQUESTING_ACCOUNT' }
  /** Asking the backend for a challenge bound to that account. */
  | { kind: 'REQUESTING_CHALLENGE'; wallet: string }
  /** Nimiq Pay is showing the signing confirmation. Not a payment. */
  | { kind: 'AWAITING_SIGNATURE'; challenge: AuthChallenge }
  /** Backend is verifying the signature and the challenge. */
  | { kind: 'VERIFYING'; challenge: AuthChallenge }
  | { kind: 'AUTHENTICATED'; session: AuthSession }
  /** The user dismissed a native dialog. Normal outcome, not an error. */
  | { kind: 'CANCELLED' }
  | { kind: 'FAILED'; reason: AuthFailureReason; message: string }

export type AuthFailureReason =
  | 'WALLET_UNAVAILABLE'
  | 'NO_ACCOUNTS'
  | 'CHALLENGE_UNAVAILABLE'
  | 'CHALLENGE_EXPIRED'
  | 'VERIFICATION_FAILED'
  | 'NETWORK'
  | 'UNKNOWN'

export function isAuthInProgress(state: AuthFlowState): boolean {
  return (
    state.kind === 'REQUESTING_ACCOUNT' ||
    state.kind === 'REQUESTING_CHALLENGE' ||
    state.kind === 'AWAITING_SIGNATURE' ||
    state.kind === 'VERIFYING'
  )
}
