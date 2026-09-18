/**
 * Public surface of the Nimiq adapter.
 *
 * Import from `@/lib/nimiq` — never from `@nimiq/mini-app-sdk` or
 * `@nimiq/hub-api` directly (docs/08-ARCHITECTURE.md §85).
 *
 * Application code reaches the wallet through `currentTransport()` and the
 * `WalletTransport` interface, which is the same shape in Nimiq Pay and in an
 * ordinary browser. The provider-specific functions below remain exported
 * because the Mini App adapter and its tests use them; nothing outside
 * `src/lib/nimiq/**` should need them.
 */
export {
  getBlockNumber,
  getNetworkReadiness,
  initNimiq,
  isConsensusEstablished,
  isInsideNimiqPay,
  listAccounts,
  resetNimiq,
  sendBasicTransaction,
  sendBasicTransactionWithData,
  signMessage,
  type BasicTransactionInput,
  type NimiqInitResult,
} from './client'
export {
  NimiqOperationError,
  isProviderErrorResponse,
  nimiqError,
  normalizeNimiqError,
} from './errors'
export {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  applyDocumentLanguage,
  hostLanguage,
  resolveLanguage,
  type SupportedLanguage,
} from './language'
export { identiconDataUrl } from './identicon'
export { miniAppOpenerUrl } from './mini-app-link'
export { IS_MAINNET, NIMIQ_NETWORK, networkLabel, resolveInitTimeoutMs, resolveNetwork } from './network'
export { HUB_ENDPOINTS, resolveHubEndpoint } from './hub-endpoint'
export { HubTransport, createHubTransport } from './hub-transport'
export { MiniAppTransport } from './mini-app-transport'
export { WalletRequestAbandoned } from './transport'
export type {
  ChallengeSignRequest,
  NetworkReadiness,
  WalletPaymentRequest,
  WalletSignature,
  WalletTransport,
} from './transport'
export {
  currentTransport,
  initWalletRuntime,
  resetWalletRuntime,
  type WalletRuntime,
} from './wallet-runtime'
