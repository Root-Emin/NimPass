/**
 * Public surface of the Nimiq adapter.
 *
 * Import from `@/lib/nimiq` — never from `@nimiq/mini-app-sdk` directly
 * (docs/08-ARCHITECTURE.md §85).
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
  type NetworkReadiness,
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
export { miniAppOpenerUrl } from './mini-app-link'
export { IS_MAINNET, NIMIQ_NETWORK, networkLabel, resolveInitTimeoutMs, resolveNetwork } from './network'
