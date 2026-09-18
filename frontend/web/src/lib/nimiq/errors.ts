import type { ErrorResponse } from '@nimiq/mini-app-sdk'

import type { NimiqError, NimiqErrorKind } from '@/types/wallet'

/**
 * Normalises everything either wallet transport can produce into a small, safe
 * set of kinds. Raw provider or Hub payloads never reach the UI
 * (docs/04-NIMIQ-MINI-APPS.md §32, docs/09-SECURITY.md §123).
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
 * The Nimiq Hub raises its own small set, defined in the Hub's `Constants.ts`
 * and in `@nimiq/rpc`, and they mean the same things:
 *
 *   CANCELED              — user dismissed the Hub request
 *   Connection was closed — user closed the Hub window
 *   REQUEST_TIMED_OUT     — the Hub gave up on the request
 *   Failed to open popup  — the browser blocked the window
 *
 * Anything else is classified heuristically and reported as UNKNOWN rather than
 * guessed at, because no further error names are documented.
 *
 * Three shapes have to be handled: a thrown exception, the Mini App SDK's
 * resolved `{ error: { type, message } }` envelope, and a plain `Error` whose
 * message *is* the Hub's error name.
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

/**
 * Copy is deliberately transport-neutral.
 *
 * The same failure can arrive from Nimiq Pay's native sheet or from the Hub's
 * window, and naming the wrong one is worse than naming neither — a desktop
 * visitor told to "open Nimiq Pay" when their Hub popup timed out is being sent
 * to fetch a phone they do not need (docs/09-SECURITY.md §126). Where the
 * remedy genuinely differs, the kind differs too: see `POPUP_BLOCKED`.
 */
const USER_FACING_COPY: Record<NimiqErrorKind, string> = {
  PROVIDER_UNAVAILABLE: "We couldn't reach a Nimiq wallet from here.",
  PROVIDER_TIMEOUT: "Your wallet didn't respond. Try again in a moment.",
  PROVIDER_INIT_FAILED: "We couldn't connect to your Nimiq wallet. Try again in a moment.",
  USER_REJECTED: 'You cancelled the request in your wallet.',
  INVALID_TRANSACTION: "Your wallet couldn't process this payment request.",
  NO_ACCOUNTS: 'No Nimiq account is available in this wallet.',
  INSUFFICIENT_FUNDS: "This wallet doesn't have enough NIM for this purchase.",
  NETWORK: "We couldn't reach the Nimiq network. Check your connection and try again.",
  POPUP_BLOCKED:
    'Your browser blocked the Nimiq wallet window. Allow pop-ups for this site, then try again.',
  WALLET_BUSY: 'Finish the wallet request that is already open first.',
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

  // Documented error names first — Mini App provider, then Hub.
  if (lower.includes('permissiondenied')) return nimiqError('USER_REJECTED', value)
  if (lower.includes('invalidtransaction')) return nimiqError('INVALID_TRANSACTION', value)

  // The Hub's own set. `CANCELED` and a closed window are the same outcome to a
  // customer: they changed their mind, and nothing happened.
  if (lower.includes('failed to open popup')) return nimiqError('POPUP_BLOCKED', value)
  if (/\bcancell?ed\b/.test(lower) || lower.includes('connection was closed')) {
    return nimiqError('USER_REJECTED', value)
  }
  if (lower.includes('request_timed_out')) return nimiqError('PROVIDER_TIMEOUT', value)

  // Undocumented phrasings that mean the same things. (Anything spelling out
  // "cancelled" is already caught above.)
  if (
    lower.includes('permission denied') ||
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('rejected by user')
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
