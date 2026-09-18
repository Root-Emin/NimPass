import { NimiqOperationError, WalletRequestAbandoned, normalizeNimiqError } from '@/lib/nimiq'
import type {
  ChallengeSignRequest,
  NetworkReadiness,
  WalletPaymentRequest,
  WalletSignature,
  WalletTransport,
} from '@/lib/nimiq'
import type { WalletTransportKind } from '@/types/wallet'

/**
 * Test doubles for the two wallet transports.
 *
 * Nimpass reaches a wallet through one interface with two implementations, so
 * tests stub *that* interface rather than either SDK. A test says which runtime
 * it is exercising and gets the same shape the application consumes.
 *
 * The doubles keep the argument shapes of the real adapters, so what a test
 * asserts is what the corresponding wallet would actually be handed:
 *
 *   `miniAppTransportDouble` calls its hooks the way `MiniAppTransport` calls
 *   `listAccounts()`, `signMessage(message)` and
 *   `sendBasicTransactionWithData({ recipient, value, data })`.
 *
 *   `hubTransportDouble` reports `gesturePerOperation`, so a flow that has to
 *   pause for a second click can be driven from a test, and it resolves its
 *   request promises the way the Hub does — *after* the window would have
 *   opened, which is the ordering the popup rule depends on.
 *
 * Both doubles normalise what their hooks throw, exactly as the real adapters
 * do, so a test can throw the wallet's own error string (`CANCELED`,
 * `PermissionDeniedError`, `Failed to open popup`) and see the application
 * state it really produces. Raw payloads never reach the UI
 * (docs/04-NIMIQ-MINI-APPS.md §32).
 */

/** Normalises a hook failure the way both real adapters do. */
async function normalised<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    // The caller's own request promise rejecting is a backend decision, not a
    // wallet failure, and passes through exactly as it does in production.
    if (error instanceof WalletRequestAbandoned) throw error
    if (error instanceof NimiqOperationError) throw error
    throw new NimiqOperationError(normalizeNimiqError(error))
  }
}

export interface MiniAppDoubleHooks {
  /** Stands in for the provider's `listAccounts()`. */
  listAccounts?: (...args: unknown[]) => Promise<string[]>
  /** Stands in for the provider's `sign(message)`. */
  signMessage?: (message: string) => Promise<{ publicKey: string; signature: string }>
  /** Stands in for `sendBasicTransactionWithData({ recipient, value, data })`. */
  sendBasicTransactionWithData?: (input: {
    recipient: string
    value: number
    data: string
  }) => Promise<string>
  /** Stands in for the read-only consensus pre-flight. */
  getNetworkReadiness?: (...args: unknown[]) => Promise<NetworkReadiness>
}

/** A Nimiq Pay transport whose provider calls are test hooks. */
export function miniAppTransportDouble(hooks: MiniAppDoubleHooks = {}): WalletTransport {
  return {
    kind: 'mini-app' as WalletTransportKind,
    signingScheme: null,
    gesturePerOperation: false,

    async requestAccount() {
      return normalised(async () => {
        const accounts = (await hooks.listAccounts?.()) ?? []
        const first = accounts[0]
        if (!first) throw new Error('no accounts')
        return first
      })
    },

    async signChallenge(request: PromiseLike<ChallengeSignRequest>): Promise<WalletSignature> {
      return normalised(async () => {
        const { message } = await request
        const signed = (await hooks.signMessage?.(message)) ?? { publicKey: '', signature: '' }
        return { publicKey: signed.publicKey, signature: signed.signature, signer: null }
      })
    },

    async pay(request: PromiseLike<WalletPaymentRequest>): Promise<string> {
      return normalised(async () => {
        const value = await request
        // Exactly the provider's own parameter names, so an assertion here is
        // an assertion about what Nimiq Pay would be sent.
        return (
          (await hooks.sendBasicTransactionWithData?.({
            recipient: value.recipient,
            value: value.valueLuna,
            data: value.data,
          })) ?? ''
        )
      })
    },

    async networkReadiness(): Promise<NetworkReadiness | null> {
      return (await hooks.getNetworkReadiness?.()) ?? { consensusEstablished: true, blockNumber: 1 }
    },
  }
}

export interface HubDoubleHooks {
  /** Stands in for `HubApi.chooseAddress()`. */
  chooseAddress?: () => Promise<string>
  /** Stands in for `HubApi.signMessage()`; receives the resolved request. */
  signMessage?: (request: ChallengeSignRequest) => Promise<WalletSignature>
  /** Stands in for `HubApi.checkout()`; receives the resolved request. */
  checkout?: (request: WalletPaymentRequest) => Promise<string>
  /**
   * Stands in for `window.open`: called synchronously as the operation is
   * entered, *before* the request promise is awaited.
   *
   * This is the moment the popup rule is about. A caller that awaited its
   * backend call first would reach here too late for the browser to allow the
   * window, so a test that cares asserts this fired while the backend request
   * was still outstanding.
   */
  windowOpened?: (operation: 'chooseAddress' | 'signMessage' | 'checkout') => void
}

/**
 * A Nimiq Hub transport whose window operations are test hooks.
 *
 * Deliberately resolves the request promise *inside* each method rather than
 * requiring the caller to await it first — the same order the real Hub uses,
 * where the window opens and the arguments are awaited afterwards. The
 * `windowOpened` hook marks that moment, so a test can assert the window was
 * already open while the backend request was still outstanding.
 */
export function hubTransportDouble(hooks: HubDoubleHooks = {}): WalletTransport {
  return {
    kind: 'hub' as WalletTransportKind,
    signingScheme: 'hub',
    gesturePerOperation: true,

    async requestAccount() {
      hooks.windowOpened?.('chooseAddress')
      return normalised(
        async () =>
          (await hooks.chooseAddress?.()) ?? 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
      )
    },

    async signChallenge(request: PromiseLike<ChallengeSignRequest>): Promise<WalletSignature> {
      hooks.windowOpened?.('signMessage')
      return normalised(async () => {
        const resolved = await request
        return (
          (await hooks.signMessage?.(resolved)) ?? {
            publicKey: 'ab'.repeat(32),
            signature: 'cd'.repeat(64),
            signer: resolved.wallet,
          }
        )
      })
    },

    async pay(request: PromiseLike<WalletPaymentRequest>): Promise<string> {
      hooks.windowOpened?.('checkout')
      return normalised(async () => {
        const resolved = await request
        return (await hooks.checkout?.(resolved)) ?? 'a'.repeat(64)
      })
    },

    /** The Hub exposes no consensus probe. Null means "cannot tell". */
    async networkReadiness(): Promise<NetworkReadiness | null> {
      return null
    },
  }
}
