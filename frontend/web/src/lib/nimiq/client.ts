import type { NimiqProvider, SignatureResult } from '@nimiq/mini-app-sdk'

import type { Luna } from '@/types/domain'
import type { NimiqError, RuntimeCapabilities } from '@/types/wallet'
import { NO_CAPABILITIES } from '@/types/wallet'

import {
  NimiqOperationError,
  isProviderErrorResponse,
  nimiqError,
  normalizeNimiqError,
  throwNormalized,
} from './errors'
import { resolveInitTimeoutMs } from './network'
import type { NetworkReadiness } from './transport'

/**
 * The one boundary between Nimpass and `@nimiq/mini-app-sdk`.
 *
 * Nothing outside `src/lib/nimiq/**` imports the SDK, calls `init()`, or touches
 * `window.nimiq` (docs/08-ARCHITECTURE.md §16-§17, §85). UI components consume
 * the hook in `@/hooks/use-wallet`, which consumes this module.
 *
 * Three rules shape everything below:
 *  1. The provider arrives asynchronously and may never arrive at all. Absence
 *     is a supported runtime state, not a crash (docs/04 §12).
 *  2. Every provider call can fail in-band (`{ error }`) or by throwing. Both
 *     are normalised before they leave this file (docs/04 §32).
 *  3. No private key, seed phrase or wallet secret is ever handled here. Nimiq
 *     Pay owns approval and signing (docs/04 §24-§25).
 */

export interface NimiqInitResult {
  provider: NimiqProvider | null
  capabilities: RuntimeCapabilities
  error: NimiqError | null
}

let initPromise: Promise<NimiqInitResult> | null = null
let cachedProvider: NimiqProvider | null = null

/** True when the Nimiq Pay host injected its read-only context. */
export function isInsideNimiqPay(): boolean {
  return typeof window !== 'undefined' && typeof window.nimiqPay === 'object' && window.nimiqPay !== null
}

/**
 * Resolves the Nimiq provider, or explains why there isn't one.
 *
 * Never rejects: callers get a result object so that a missing wallet can be
 * rendered as a state instead of caught as an exception. Concurrent callers
 * share one in-flight attempt.
 */
export function initNimiq(options: { timeoutMs?: number } = {}): Promise<NimiqInitResult> {
  if (initPromise) return initPromise
  initPromise = runInit(options.timeoutMs ?? resolveInitTimeoutMs())
  return initPromise
}

/** Drops the cached provider so the next `initNimiq()` starts fresh. */
export function resetNimiq(): void {
  initPromise = null
  cachedProvider = null
}

async function runInit(timeoutMs: number): Promise<NimiqInitResult> {
  const insideNimiqPay = isInsideNimiqPay()

  if (typeof window === 'undefined') {
    return { provider: null, capabilities: NO_CAPABILITIES, error: null }
  }

  try {
    const { init } = await import('@nimiq/mini-app-sdk')
    const provider = await withTimeout(init({ timeout: timeoutMs }), timeoutMs)

    if (!provider) {
      return unavailable(insideNimiqPay)
    }

    cachedProvider = provider
    return {
      provider,
      capabilities: {
        nimiqProviderAvailable: true,
        walletOperationsAvailable: true,
        insideNimiqPay,
        transport: 'mini-app',
        // Native approval sheets are not browser popups: one user action can
        // carry a whole flow. Only the Hub transport needs a gesture each time.
        gesturePerOperation: false,
      },
      error: null,
    }
  } catch (error) {
    // Outside Nimiq Pay there is simply no provider. That is the expected
    // desktop/mobile-browser case and must read as "unavailable", not "broken".
    if (!insideNimiqPay) {
      return unavailable(false)
    }

    const normalized = normalizeNimiqError(error)
    return {
      provider: null,
      capabilities: { ...NO_CAPABILITIES, insideNimiqPay: true },
      error:
        normalized.kind === 'PROVIDER_TIMEOUT'
          ? normalized
          : nimiqError('PROVIDER_INIT_FAILED', error),
    }
  }
}

function unavailable(insideNimiqPay: boolean): NimiqInitResult {
  return {
    provider: null,
    capabilities: { ...NO_CAPABILITIES, insideNimiqPay },
    error: null,
  }
}

class TimeoutError extends Error {
  constructor() {
    super('Nimiq provider initialization timed out')
    this.name = 'TimeoutError'
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function requireProvider(): Promise<NimiqProvider> {
  if (cachedProvider) return cachedProvider
  const result = await initNimiq()
  if (!result.provider) {
    throw new NimiqOperationError(result.error ?? nimiqError('PROVIDER_UNAVAILABLE'))
  }
  return result.provider
}

/**
 * Runs a provider call and normalises both failure shapes: a resolved
 * `{ error }` envelope and a thrown exception.
 */
async function call<T>(operation: () => Promise<unknown>): Promise<T> {
  let value: unknown
  try {
    value = await operation()
  } catch (error) {
    if (error instanceof NimiqOperationError) throw error
    throwNormalized(error)
  }
  if (isProviderErrorResponse(value)) throwNormalized(value)
  return value as T
}

/* -------------------------------------------------------------------------
 * Native approval serialisation
 *
 * `listAccounts`, `sign` and the `send*` methods each open a native Nimiq Pay
 * confirmation sheet. Nothing in the provider API prevents a second one from
 * being requested while the first is still open, and the resulting stacked
 * sheets are both a UX failure and a consent failure: a user cannot tell which
 * request they are approving.
 *
 * Individual flows already guard themselves, but those guards are per-flow —
 * they cannot see each other. Signing in from the header while a purchase is
 * waiting for approval crosses two independent guards, so the lock lives here,
 * at the single boundary every wallet call passes through.
 *
 * It refuses rather than queues. Queuing would pop a sheet the user has since
 * stopped expecting; refusing keeps approval tied to the action that asked for
 * it (docs/04-NIMIQ-MINI-APPS.md §24, §56).
 * ---------------------------------------------------------------------- */

let approvalInFlight = false

async function withApproval<T>(operation: () => Promise<T>): Promise<T> {
  if (approvalInFlight) {
    throw new NimiqOperationError(nimiqError('WALLET_BUSY'))
  }
  approvalInFlight = true
  try {
    return await operation()
  } finally {
    approvalInFlight = false
  }
}

/* -------------------------------------------------------------------------
 * Provider operations
 *
 * Every method below maps 1:1 onto the official Nimiq Provider API
 * (https://nimiq.dev/mini-apps/api-reference/nimiq-provider). Nothing is
 * invented, and the staking methods the provider also exposes are deliberately
 * not surfaced — Nimpass has no staking feature.
 *
 * Which calls open a native dialog is taken from that reference, not guessed:
 *   listAccounts                 confirmation: yes
 *   sign                         confirmation: yes
 *   sendBasicTransaction         confirmation: yes
 *   sendBasicTransactionWithData confirmation: yes
 *   isConsensusEstablished       confirmation: no
 *   getBlockNumber               confirmation: no
 *
 * The reference documents *which* calls need confirmation but says nothing about
 * issuing several at once. Serialising them (see `withApproval` above) and
 * tying each to a distinct user action is therefore a Nimpass decision, not a
 * platform rule — made because stacked approval sheets destroy informed consent
 * (docs/04-NIMIQ-MINI-APPS.md §24, §56).
 * ---------------------------------------------------------------------- */

/**
 * Addresses the wallet is willing to reveal.
 *
 * An address is an identity *hint*, never proof of control — authorisation
 * always needs a server-issued challenge and a signature (docs/04 §15,
 * docs/09-SECURITY.md §11, §19).
 */
export async function listAccounts(fresh = false): Promise<string[]> {
  const provider = await requireProvider()
  return withApproval(() => call<string[]>(() => {
    // SDK 0.1.0 caches accounts. Disconnect clears that cache; the next read
    // asks the host again. This is not an application logout.
    if (fresh) provider.disconnect()
    return provider.listAccounts()
  }))
}

/**
 * Signs a message the *backend* produced.
 *
 * Nimpass never invents the text: domain separation and challenge binding are
 * the server's job (docs/09-SECURITY.md §15, §20, §52). This function passes
 * through whatever challenge message it is handed.
 */
export async function signMessage(message: string): Promise<SignatureResult> {
  const provider = await requireProvider()
  return withApproval(() => call<SignatureResult>(() => provider.sign(message)))
}

export async function isConsensusEstablished(): Promise<boolean> {
  const provider = await requireProvider()
  return call<boolean>(() => provider.isConsensusEstablished())
}

export async function getBlockNumber(): Promise<number> {
  const provider = await requireProvider()
  return call<number>(() => provider.getBlockNumber())
}

/**
 * Read-only pre-flight before a payment.
 *
 * The reference marks both calls "confirmation: no", so issuing them together
 * costs the user nothing. A wallet without consensus cannot reliably submit a
 * transaction, so this is checked before asking the user to approve one rather
 * than after — a Nimpass choice, not something the platform prescribes.
 *
 * Never throws: a readiness probe must not be able to fail a purchase on its
 * own. An unreachable probe simply reports "not established".
 */
export async function getNetworkReadiness(): Promise<NetworkReadiness> {
  try {
    const provider = await requireProvider()
    const [consensusEstablished, blockNumber] = await Promise.all([
      call<boolean>(() => provider.isConsensusEstablished()),
      call<number>(() => provider.getBlockNumber()),
    ])
    return { consensusEstablished, blockNumber }
  } catch {
    return { consensusEstablished: false, blockNumber: null }
  }
}

export interface BasicTransactionInput {
  recipient: string
  /** Integer Luna, exactly as the backend specified it. */
  value: Luna
  fee?: number
}

/**
 * Sends a plain NIM transfer.
 *
 * `recipient` and `value` must come from a backend-issued purchase intent. The
 * frontend never decides an amount (docs/08-ARCHITECTURE.md §71).
 */
export async function sendBasicTransaction(input: BasicTransactionInput): Promise<string> {
  const provider = await requireProvider()
  return withApproval(() => call<string>(() => provider.sendBasicTransaction(input)))
}

/**
 * Sends a NIM transfer carrying the opaque payment reference in its data field.
 * This is the MVP purchase method (docs/05-NIMIQ-PAY-INTEGRATION.md §23-§27).
 */
export async function sendBasicTransactionWithData(
  input: BasicTransactionInput & { data: string },
): Promise<string> {
  const provider = await requireProvider()
  return withApproval(() => call<string>(() => provider.sendBasicTransactionWithData(input)))
}
