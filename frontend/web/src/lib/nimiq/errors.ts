import type { ErrorResponse } from '@nimiq/mini-app-sdk'

import type { NimiqError, NimiqErrorKind } from '@/types/wallet'

/**
 * Normalises everything the Nimiq provider can produce into a small, safe set
 * of kinds. Raw provider payloads never reach the UI
 * (docs/04-NIMIQ-MINI-APPS.md §32).
 *
 * The documented error names come from the official Nimiq Provider API
 * reference (https://nimiq.dev/mini-apps/api-reference/nimiq-provider):
 *
 *   PermissionDeniedError  — user rejected the confirmation dialog
 *                            (listAccounts, sign, and every send* method)
 *   InvalidTransactionError — transaction data malformed
 *                            (every send* method)
 *
 * The FAQ adds that calls can also fail because the request timed out, no
 * accounts are available, or the network is unreachable, and that cancellation
 * must be treated as a normal outcome rather than a bug.
 * Ref: https://nimiq.dev/mini-apps/faq
 *
 * Anything else is classified heuristically and reported as UNKNOWN rather than
 * guessed at, because no further error names are documented.
 *
 * Two shapes have to be handled, because the SDK uses both: a thrown exception,
 * and a resolved `{ error: { type, message } }` value.
 */

/** Type guard for the SDK's in-band error envelope. */
export function isProviderErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ErrorResponse).error === 'object' &&
    (value as ErrorResponse).error !== null
  )
}

const USER_FACING_COPY: Record<NimiqErrorKind, string> = {
  PROVIDER_UNAVAILABLE:
    "Nimiq Pay isn't available here. Open Nimpass in Nimiq Pay to continue.",
  PROVIDER_TIMEOUT: "Nimiq Pay didn't respond. Try again in a moment.",
  PROVIDER_INIT_FAILED: "We couldn't connect to Nimiq Pay. Try again in a moment.",
  USER_REJECTED: 'You cancelled the request in Nimiq Pay.',
  INVALID_TRANSACTION: "Nimiq Pay couldn't process this payment request.",
  NO_ACCOUNTS: 'No Nimiq account is available in this wallet.',
  INSUFFICIENT_FUNDS: "This wallet doesn't have enough NIM for this purchase.",
  NETWORK: "We couldn't reach the Nimiq network. Check your connection and try again.",
  WALLET_BUSY: 'Finish the request already open in Nimiq Pay first.',
  UNKNOWN: 'Something went wrong with the wallet request. Please try again.',
}

export function nimiqError(kind: NimiqErrorKind, cause?: unknown): NimiqError {
  return { kind, message: USER_FACING_COPY[kind], cause }
}

/**
 * Classifies a provider failure, preferring the documented error names.
 *
 * User rejection is singled out deliberately: it is a normal outcome, not an
 * error state (docs/04 §31, and the official FAQ).
 */
export function normalizeNimiqError(value: unknown): NimiqError {
  const text = extractErrorText(value)
  const lower = text.toLowerCase()

  // Documented error names first.
  if (lower.includes('permissiondenied')) return nimiqError('USER_REJECTED', value)
  if (lower.includes('invalidtransaction')) return nimiqError('INVALID_TRANSACTION', value)

  // Undocumented phrasings that mean the same things.
  if (
    lower.includes('permission denied') ||
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('rejected by user') ||
    lower.includes('cancelled by user') ||
    lower.includes('canceled by user')
  ) {
    return nimiqError('USER_REJECTED', value)
  }

  if (lower.includes('no accounts') || lower.includes('account not found')) {
    return nimiqError('NO_ACCOUNTS', value)
  }

  if (lower.includes('insufficient') || lower.includes('not enough balance')) {
    return nimiqError('INSUFFICIENT_FUNDS', value)
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return nimiqError('PROVIDER_TIMEOUT', value)
  }

  if (
    lower.includes('network') ||
    lower.includes('consensus') ||
    lower.includes('offline') ||
    lower.includes('connection')
  ) {
    return nimiqError('NETWORK', value)
  }

  if (lower.includes('provider') && (lower.includes('not found') || lower.includes('unavailable'))) {
    return nimiqError('PROVIDER_UNAVAILABLE', value)
  }

  return nimiqError('UNKNOWN', value)
}

function extractErrorText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (isProviderErrorResponse(value)) {
    const { type, message } = value.error
    return `${type ?? ''} ${message ?? ''}`
  }
  if (value instanceof Error) {
    return `${value.name} ${value.message}`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const parts = ['name', 'type', 'code', 'message']
      .map((key) => record[key])
      .filter((part): part is string => typeof part === 'string')
    if (parts.length > 0) return parts.join(' ')
  }
  return ''
}

/** A thrown error carrying a normalised Nimiq failure. */
export class NimiqOperationError extends Error {
  readonly kind: NimiqErrorKind
  readonly normalized: NimiqError

  constructor(normalized: NimiqError) {
    super(normalized.message, { cause: normalized.cause })
    this.name = 'NimiqOperationError'
    this.normalized = normalized
    this.kind = normalized.kind
  }

  /** Cancellation is a normal outcome, never a failure to report as one. */
  get isUserRejection(): boolean {
    return this.kind === 'USER_REJECTED'
  }
}

export function throwNormalized(value: unknown): never {
  throw new NimiqOperationError(normalizeNimiqError(value))
}
