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
 * A wallet signature as the backend contract takes it: hex `publicKey` and
 * `signature` (`Proof` in `backend/openapi.yaml`).
 *
 * The Nimiq provider's `sign()` returns exactly this shape
 * (https://nimiq.dev/mini-apps/api-reference/nimiq-provider). The Hub's
 * `signMessage()` returns `Uint8Array`s instead, and the difference is
 * normalised inside the wallet adapter rather than leaked here
 * (`src/lib/nimiq/transport.ts`).
 */
export interface WalletSignature {
  publicKey: string
  signature: string
}

/**
 * The signing scheme a proof was produced under, when the transport can name
 * one (`Proof.signingScheme` in `backend/openapi.yaml`).
 *
 * The backend verifies an Ed25519 signature over a deterministic transform of
 * its own challenge message, and the two supported wallet surfaces transform it
 * differently: the Hub documents an envelope
 * (`sha256('\x16Nimiq Signed Message:\n' + length + message)`), while the
 * Mini App host's preprocessing is undocumented and stays on the deployment's
 * configured default.
 *
 * Omitted means "use the server default". A client never widens what a
 * signature means by naming a scheme: the message is still the server's exact
 * nonce-bearing challenge, and only one transform is applied to it.
 */
export type SigningScheme = 'raw' | 'hub'

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
  /** Asking the wallet which account to use — opens a dialog or a Hub window. */
  | { kind: 'REQUESTING_ACCOUNT' }
  /** Asking the backend for a challenge bound to that account. */
  | { kind: 'REQUESTING_CHALLENGE'; wallet: string }
  /**
   * The wallet named an account, the backend issued its challenge, and the
   * signature is waiting for the user to ask for it.
   *
   * Only reached on a transport that needs a user gesture per wallet operation
   * — today, the Hub, because browsers grant one popup per click and this flow
   * needs two wallet windows. It is a *pause in one flow*, not a second flow:
   * the challenge is already in hand and the next step is the same
   * `sign → verify` every runtime performs (docs/09-SECURITY.md §12).
   */
  | { kind: 'WALLET_SELECTED'; wallet: string; challenge: AuthChallenge }
  /**
   * The wallet is showing its signing confirmation. Not a payment.
   *
   * Carries the wallet rather than the challenge: the challenge request may
   * still be in flight, because it is handed to the wallet as a promise so a
   * Hub popup can open on the click instead of after the fetch.
   */
  | { kind: 'AWAITING_SIGNATURE'; wallet: string }
  /** Backend is verifying the signature and the challenge. */
  | { kind: 'VERIFYING'; challenge: AuthChallenge }
  | { kind: 'AUTHENTICATED'; session: AuthSession }
  /** The user dismissed a native dialog. Normal outcome, not an error. */
  | { kind: 'CANCELLED' }
  | { kind: 'FAILED'; reason: AuthFailureReason; message: string }

export type AuthFailureReason =
  | 'WALLET_UNAVAILABLE'
  /** The browser blocked the Hub window. Recoverable, and retrying is right. */
  | 'POPUP_BLOCKED'
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

/**
 * True while the flow is waiting for the user rather than for a wallet or the
 * backend. `WALLET_SELECTED` is deliberately not "in progress": nothing is in
 * flight, and the dialog must offer a button rather than a spinner.
 */
export function isAwaitingUserStep(state: AuthFlowState): boolean {
  return state.kind === 'WALLET_SELECTED'
}
