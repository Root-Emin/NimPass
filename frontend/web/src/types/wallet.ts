import type { NimiqNetwork } from './domain'

/**
 * Runtime capability model for Nimiq wallet access.
 *
 * Nimpass runs in two contexts of one product: an ordinary browser and the
 * Nimiq Pay WebView (docs/04-NIMIQ-MINI-APPS.md §7-§8). Both are wallet-capable
 * — they simply reach the wallet through different transports:
 *
 *   Nimiq Pay WebView  →  `@nimiq/mini-app-sdk`, the injected Nimiq provider
 *   ordinary browser   →  `@nimiq/hub-api`, the official Nimiq Hub
 *
 * Public browsing must still work when neither is usable: "no wallet here" is a
 * normal runtime state, not a crash (§12, docs/08-ARCHITECTURE.md §87).
 */
export type WalletStatus =
  /** No wallet transport could be established. Expected, not an error. */
  | 'unavailable'
  /** Resolving which transport this runtime gets. */
  | 'initializing'
  /** A transport is present and usable. */
  | 'ready'
  /** A transport was expected, but initialisation failed. */
  | 'error'

/**
 * Which wallet transport is serving this runtime.
 *
 * This is the *only* place the difference is named. The authentication model,
 * purchase lifecycle, backend contracts and security rules are identical on
 * both; components consume capabilities, never this discriminator
 * (docs/08-ARCHITECTURE.md §15-§17).
 */
export type WalletTransportKind =
  /** Inside Nimiq Pay: the injected provider via `@nimiq/mini-app-sdk`. */
  | 'mini-app'
  /** Ordinary browser: the official Nimiq Hub via `@nimiq/hub-api`. */
  | 'hub'

export interface RuntimeCapabilities {
  /** A Nimiq wallet transport is present and initialised. */
  nimiqProviderAvailable: boolean
  /** Wallet operations (choose account, sign, pay) can be attempted. */
  walletOperationsAvailable: boolean
  /** We appear to be inside the Nimiq Pay host (host context was injected). */
  insideNimiqPay: boolean
  /** Which transport answered, or null when none did. */
  transport: WalletTransportKind | null
  /**
   * True when each wallet operation needs its own user gesture.
   *
   * The Hub opens a browser popup, and browsers grant one popup per user
   * activation — so a flow needing two wallet operations needs two deliberate
   * clicks. Nimiq Pay's native sheets have no such rule. The UI reads this to
   * decide whether to pause between steps; it never reads the transport name.
   * Ref: https://nimiq.dev/hub/getting-started ("Call Hub methods synchronously
   * within user actions (clicks, touches) to avoid popup blockers.")
   */
  gesturePerOperation: boolean
}

export const NO_CAPABILITIES: RuntimeCapabilities = {
  nimiqProviderAvailable: false,
  walletOperationsAvailable: false,
  insideNimiqPay: false,
  transport: null,
  gesturePerOperation: false,
}

/**
 * Normalised wallet failure kinds. Raw SDK/Hub errors never reach the UI (§32).
 *
 * `USER_REJECTED` and `INVALID_TRANSACTION` correspond to the two error names
 * the official Nimiq Provider API documents — `PermissionDeniedError` and
 * `InvalidTransactionError`. The rest cover the failure modes the official FAQ
 * describes (timeout, no accounts available, network unreachable), the Hub's
 * own documented outcomes, plus a catch-all; no further error names are
 * invented.
 * Ref: https://nimiq.dev/mini-apps/api-reference/nimiq-provider
 * Ref: https://nimiq.github.io/hub/
 */
export type NimiqErrorKind =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_INIT_FAILED'
  /** `PermissionDeniedError`, or the Hub's `CANCELED`. Normal (§31). */
  | 'USER_REJECTED'
  /** `InvalidTransactionError` — transaction data malformed. */
  | 'INVALID_TRANSACTION'
  | 'NO_ACCOUNTS'
  | 'INSUFFICIENT_FUNDS'
  | 'NETWORK'
  /**
   * The browser refused to open the Hub window. Specific to the Hub transport,
   * and recoverable: the user allows pop-ups, or clicks again. Distinguished
   * from a cancellation because the remedy is completely different.
   */
  | 'POPUP_BLOCKED'
  /**
   * A Nimpass-side refusal, not a wallet error: another wallet operation is
   * already waiting on its approval, so this one was not started
   * (see `src/lib/nimiq/client.ts`).
   */
  | 'WALLET_BUSY'
  | 'UNKNOWN'

/**
 * Wallet state as the UI consumes it.
 *
 * `account` is the address the wallet reported. It is an identity *hint* for
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
