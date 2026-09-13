import type { NimiqNetwork } from './domain'

/**
 * Runtime capability model for the Nimiq provider.
 *
 * Nimpass runs in two contexts of one product: an ordinary browser and the
 * Nimiq Pay WebView (docs/04-NIMIQ-MINI-APPS.md §7-§8). Public browsing must
 * keep working when no provider exists — "Nimiq unavailable" is a normal
 * runtime state, not a crash (§12, docs/08-ARCHITECTURE.md §87).
 */
export type WalletStatus =
  /** No Nimiq provider in this runtime. Ordinary browser — expected, not an error. */
  | 'unavailable'
  /** Waiting for Nimiq Pay to inject the provider. */
  | 'initializing'
  /** Provider present and usable. */
  | 'ready'
  /** Provider exists or was expected, but initialisation failed. */
  | 'error'

export interface RuntimeCapabilities {
  /** A Nimiq provider object is present and initialised. */
  nimiqProviderAvailable: boolean
  /** Wallet operations (sign, send) can be attempted. */
  walletOperationsAvailable: boolean
  /** We appear to be inside the Nimiq Pay host (host context was injected). */
  insideNimiqPay: boolean
}

export const NO_CAPABILITIES: RuntimeCapabilities = {
  nimiqProviderAvailable: false,
  walletOperationsAvailable: false,
  insideNimiqPay: false,
}

/**
 * Normalised provider failure kinds. Raw SDK errors never reach the UI (§32).
 *
 * `USER_REJECTED` and `INVALID_TRANSACTION` correspond to the two error names
 * the official Nimiq Provider API documents — `PermissionDeniedError` and
 * `InvalidTransactionError`. The rest cover the failure modes the official FAQ
 * describes (timeout, no accounts available, network unreachable) plus a
 * catch-all; no further error names are documented, so none are invented.
 * Ref: https://nimiq.dev/mini-apps/api-reference/nimiq-provider
 */
export type NimiqErrorKind =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_INIT_FAILED'
  /** `PermissionDeniedError` — user rejected the native dialog. Normal (§31). */
  | 'USER_REJECTED'
  /** `InvalidTransactionError` — transaction data malformed. */
  | 'INVALID_TRANSACTION'
  | 'NO_ACCOUNTS'
  | 'INSUFFICIENT_FUNDS'
  | 'NETWORK'
  /**
   * A Nimpass-side refusal, not a provider error: another wallet operation is
   * already waiting on its native approval sheet, so this one was not started
   * (see `src/lib/nimiq/client.ts`).
   */
  | 'WALLET_BUSY'
  | 'UNKNOWN'

/**
 * Wallet state as the UI consumes it.
 *
 * `account` is the address the provider reported. It is an identity *hint* for
 * display only — knowing an address is not controlling it, so nothing may be
 * authorised on this value alone (docs/09-SECURITY.md §11, §19).
 */
export interface WalletState {
  status: WalletStatus
  capabilities: RuntimeCapabilities
  network: NimiqNetwork
  account: string | null
  error: NimiqError | null
}

export interface NimiqError {
  kind: NimiqErrorKind
  /** Safe, user-facing sentence. Never a raw RPC payload. */
  message: string
  /** Original value, kept for logging only. Never rendered. */
  cause?: unknown
}
