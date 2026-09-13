/**
 * Transport-level contract with the Nimpass backend.
 *
 * Success envelope and error envelope follow docs/08-ARCHITECTURE.md §65:
 *   { "data": { ... } }
 *   { "error": { "code": "PASS_COMPLETED", "message": "..." } }
 */

export interface ApiEnvelope<T> {
  data: T
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

/**
 * Stable machine-readable domain error codes (§66). The frontend translates
 * these into human copy; it never parses `message` to make decisions.
 */
export const DOMAIN_ERROR_CODES = [
  'PACKAGE_NOT_FOUND',
  'PACKAGE_UNAVAILABLE',
  'PROVIDER_NOT_FOUND',
  'PURCHASE_NOT_FOUND',
  'PAYMENT_NOT_CONFIRMED',
  'PASS_NOT_FOUND',
  'PASS_NOT_OWNED',
  'PASS_COMPLETED',
  'PASS_EXPIRED',
  'REDEMPTION_EXPIRED',
  'REDEMPTION_ALREADY_USED',
  'UNAUTHORIZED',
] as const

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]

/** Codes the client synthesises for failures that never reached the domain. */
export type TransportErrorCode =
  /** Request never produced a response: offline, DNS, CORS, backend down. */
  | 'NETWORK_ERROR'
  /** Response arrived but was not a readable Nimpass envelope. */
  | 'MALFORMED_RESPONSE'
  /** Caller aborted the request. Not a failure to report to the user. */
  | 'ABORTED'
  /** HTTP error with no recognised domain code. */
  | 'HTTP_ERROR'

export type ApiErrorCode = DomainErrorCode | TransportErrorCode | (string & {})
