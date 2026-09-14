import type { ApiErrorCode } from '@/types/api'

/**
 * One error type for everything the API layer can produce.
 *
 * A network failure and a domain rejection are deliberately *not* collapsed
 * into the same thing: "we could not reach the backend" and "this pass has no
 * sessions left" require different UI and different recovery.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  /** HTTP status, or 0 when the request never produced a response. */
  readonly status: number
  readonly details?: unknown

  constructor(params: {
    code: ApiErrorCode
    message: string
    status?: number
    details?: unknown
    cause?: unknown
  }) {
    super(params.message, { cause: params.cause })
    this.name = 'ApiError'
    this.code = params.code
    this.status = params.status ?? 0
    this.details = params.details
  }

  /** The request never reached the backend. Retrying may genuinely help. */
  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR'
  }

  /** The caller aborted. Nothing to show the user. */
  get isAborted(): boolean {
    return this.code === 'ABORTED'
  }

  /** The backend answered with a domain rule. Retrying the same call will not help. */
  get isDomainError(): boolean {
    return !this.isNetworkError && !this.isAborted && this.status >= 400
  }

  /**
   * The session is missing, expired or not trusted for this write.
   *
   * Covers both spellings in play: the `UNAUTHORIZED` code docs §66 defines,
   * and `AUTH_REQUIRED` / `CSRF_INVALID` as the Go backend emits them. CSRF
   * counts because the only way a valid session fails that check is that it is
   * no longer the session the client thinks it holds.
   */
  get isUnauthorized(): boolean {
    return (
      this.code === 'UNAUTHORIZED' ||
      this.code === 'AUTH_REQUIRED' ||
      this.code === 'CSRF_INVALID' ||
      this.status === 401
    )
  }

  /** Authenticated, but not allowed to touch this object (docs/09 §67). */
  get isForbidden(): boolean {
    return this.code === 'FORBIDDEN' || this.status === 403
  }
}

/**
 * Human copy for stable domain codes (docs/08-ARCHITECTURE.md §66).
 *
 * Falls back to the backend's own message, and only then to a generic line —
 * raw database or RPC text must never surface (§65).
 */
const DOMAIN_ERROR_COPY: Record<string, string> = {
  /* Codes docs/08-ARCHITECTURE.md §66 defines for the domain. */
  PACKAGE_NOT_FOUND: "This package doesn't exist or was removed.",
  PACKAGE_UNAVAILABLE: 'This package is no longer available for purchase.',
  PROVIDER_NOT_FOUND: "This provider page doesn't exist.",
  PURCHASE_NOT_FOUND: "We couldn't find this purchase.",
  PAYMENT_NOT_CONFIRMED: 'This payment has not been confirmed yet.',
  PASS_NOT_FOUND: "We couldn't find this pass.",
  PASS_NOT_OWNED: 'This pass belongs to a different wallet.',
  PASS_COMPLETED: 'This pass has no sessions remaining.',
  PASS_EXPIRED: 'This pass has expired.',
  REDEMPTION_EXPIRED: 'This session code expired. Generate a new one.',
  REDEMPTION_ALREADY_USED: 'This session code was already used.',
  UNAUTHORIZED: 'Connect your wallet to continue.',

  /*
   * Codes the Go backend actually emits today (`internal/httpapi`). They are a
   * different, more generic set than §66's, so without copy here they fell
   * through to the server's own wording — "Not authorized", "Internal server
   * error", "Invalid state transition" — which is developer language leaking
   * into the product (docs/02-USER-FLOWS.md §99, docs/09-SECURITY.md §94).
   *
   * Each one is kept distinct rather than collapsed into "something went
   * wrong": an expired sign-in, a permission problem and a rate limit need
   * different responses from the user.
   */
  AUTH_REQUIRED: 'Your session has ended. Sign in again to continue.',
  CSRF_INVALID: 'Your session has ended. Sign in again to continue.',
  ORIGIN_FORBIDDEN: 'Your session has ended. Sign in again to continue.',
  FORBIDDEN: "You don't have access to this.",
  CHALLENGE_EXPIRED: 'That request expired. Try again.',
  CHALLENGE_CONSUMED: 'That request was already used. Try again.',
  INVALID_SIGNATURE: "We couldn't verify that signature. Try again.",
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  CONFLICT: "That didn't apply, because something changed. Reload and try again.",

  /*
   * Payment codes. Worded so that neither one can be read as "nothing
   * happened": by the time either appears a transaction may exist, and telling
   * someone their payment failed is how they end up paying twice
   * (docs/09-SECURITY.md §96, docs/05 §62).
   */
  PAYMENT_CONFLICT:
    "This payment doesn't match what we're expecting for this purchase. Don't send another one — open the purchase to see where it stands.",
  INTENT_EXPIRED:
    'This purchase expired before the payment arrived. If you already sent NIM, do not send it again — open the purchase and we will keep checking.',
  /*
   * The backend refuses a new purchase once a fixed-expiration package is too
   * close to its end date to settle safely. Nobody has been charged, so this is
   * not phrased as a payment problem — and it is not phrased as "try again"
   * either, because the same request would be refused for the same reason.
   */
  PACKAGE_PURCHASE_CUTOFF:
    "This package is too close to its end date to buy safely, so we didn't start a payment. Have a look at the other packages from this provider.",
  /*
   * Redemption codes (Mission 04.1).
   *
   * Two rules shape this copy. Nothing here may leak whether a reference
   * exists, belongs to another provider, or was ever valid — a provider who can
   * distinguish "not a code" from "someone else's code" can probe for live
   * references (§31). And every one of these outcomes left the session
   * *unused*, so none of them may read as though something was spent.
   */
  REDEMPTION_CHALLENGE_EXPIRED:
    'This code has expired. Ask for a new one — no session was used.',
  REDEMPTION_ALREADY_CONSUMED:
    'This session has already been used. Nothing was used twice.',
  REDEMPTION_NOT_AUTHORIZED:
    "This code isn't ready yet. The customer needs to approve it in their wallet first.",
  INVALID_REDEMPTION_SIGNATURE:
    "We couldn't verify that approval, so no session was used. Try again.",
  STALE_REDEMPTION_CHALLENGE:
    'This code is out of date — the pass changed after it was made. Ask for a new one.',
  // Deliberately uninformative: a code that never existed, one that belongs to
  // another provider, and one that was withdrawn all read identically.
  INVALID_REDEMPTION_TOKEN: "This code isn't valid or can't be used here.",

  VALIDATION_ERROR: "Some details weren't accepted. Check them and try again.",
  NOT_FOUND: "We couldn't find that.",
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',

  /* Transport-level codes the client synthesises. */
  NETWORK_ERROR: "We couldn't reach Nimpass. Check your connection and try again.",
  MALFORMED_RESPONSE: 'Something went wrong on our side. Please try again.',
  HTTP_ERROR: 'Something went wrong. Please try again.',
}

export function messageForApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return DOMAIN_ERROR_COPY[error.code] ?? error.message ?? DOMAIN_ERROR_COPY.HTTP_ERROR
  }
  return DOMAIN_ERROR_COPY.HTTP_ERROR
}

/** Coerces anything thrown inside the API layer into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError({ code: 'ABORTED', message: 'Request aborted.', cause: error })
  }
  return new ApiError({
    code: 'NETWORK_ERROR',
    message: DOMAIN_ERROR_COPY.NETWORK_ERROR,
    cause: error,
  })
}
