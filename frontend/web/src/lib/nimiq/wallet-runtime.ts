import type { NimiqError, RuntimeCapabilities } from '@/types/wallet'
import { NO_CAPABILITIES } from '@/types/wallet'

import { initNimiq, isInsideNimiqPay, resetNimiq } from './client'
import { NimiqOperationError, nimiqError } from './errors'
import { createHubTransport } from './hub-transport'
import { MiniAppTransport } from './mini-app-transport'
import type { WalletTransport } from './transport'

/**
 * Runtime selection: which wallet transport this browser gets.
 *
 * This is the one `if` in the application. Components, pages and hooks consume
 * capabilities — "can I sign?", "does this need its own click?" — and never ask
 * where they are running (docs/08-ARCHITECTURE.md §15-§17, §86).
 *
 * The rule is capability detection, not user-agent guessing (docs/04 §60):
 *
 *   the Mini App SDK returns a provider   →  Nimiq Pay, use the provider
 *   it does not                           →  ordinary browser, use the Hub
 *
 * Nimiq Pay is tried first and always wins, so a Mini App session never sees a
 * Hub popup. That ordering is the whole compatibility guarantee: the existing
 * Mini App integration is unchanged, and the Hub only fills the gap where there
 * previously was no wallet at all.
 *
 * ## Why this resolves eagerly
 *
 * `WalletProvider` starts resolution on mount, long before anyone clicks. That
 * is not a performance nicety: loading `@nimiq/hub-api` is an `await`, and an
 * `await` between a click and `window.open` is exactly what gets a Hub popup
 * blocked. Resolving up front means the path from the click to the popup is
 * synchronous. `currentTransport()` exists for that path.
 */

export interface WalletRuntime {
  transport: WalletTransport | null
  capabilities: RuntimeCapabilities
  error: NimiqError | null
}

let runtimePromise: Promise<WalletRuntime> | null = null
let cached: WalletRuntime | null = null

/**
 * Resolves the wallet runtime once. Never rejects: "no wallet here" is a state
 * to render, not an exception to catch (docs/04 §12, docs/08 §87).
 */
export function initWalletRuntime(): Promise<WalletRuntime> {
  if (runtimePromise) return runtimePromise
  runtimePromise = resolve()
  return runtimePromise
}

/**
 * Drops the resolved runtime so the next `initWalletRuntime()` starts fresh.
 *
 * Clears the cached Mini App provider too: a "Try again" that reused a failed
 * `init()` would report the same failure forever.
 */
export function resetWalletRuntime(): void {
  runtimePromise = null
  cached = null
  resetNimiq()
}

/**
 * The already-resolved transport, or null.
 *
 * Synchronous by design. Call it from inside a click handler before doing
 * anything else; `await initWalletRuntime()` there would cost the popup.
 */
export function currentTransport(): WalletTransport | null {
  return cached?.transport ?? null
}

async function resolve(): Promise<WalletRuntime> {
  if (typeof window === 'undefined') {
    return remember({ transport: null, capabilities: NO_CAPABILITIES, error: null })
  }

  const insideNimiqPay = isInsideNimiqPay()

  // Ordinary browsers never receive an injected provider. Waiting for Mini App
  // `init()` here costs the SDK timeout (3s by default) and leaves the first
  // Login click with no transport — which used to read as "couldn't log you in"
  // and then succeed on the second press. Nimiq Pay is identified by
  // `window.nimiqPay` (docs/04 §33); only that runtime waits for the SDK.
  if (!insideNimiqPay) {
    return resolveHub()
  }

  // Inside the host this is the only correct answer, and the Mini App
  // experience must not change.
  const provider = await initNimiq()
  if (provider.provider) {
    return remember({
      transport: new MiniAppTransport(),
      capabilities: {
        nimiqProviderAvailable: true,
        walletOperationsAvailable: true,
        insideNimiqPay,
        transport: 'mini-app',
        gesturePerOperation: false,
      },
      error: null,
    })
  }

  // Inside Nimiq Pay with no provider, the Hub is not the fallback: the host
  // owns the wallet, and opening a web popup inside its WebView would be a
  // second, unrelated wallet. Report the host's own failure instead.
  return remember({
    transport: null,
    capabilities: { ...NO_CAPABILITIES, insideNimiqPay: true },
    error: provider.error ?? nimiqError('PROVIDER_UNAVAILABLE'),
  })
}

async function resolveHub(): Promise<WalletRuntime> {
  try {
    const transport = await createHubTransport()
    return remember({
      transport,
      capabilities: {
        nimiqProviderAvailable: false,
        walletOperationsAvailable: true,
        insideNimiqPay: false,
        transport: 'hub',
        gesturePerOperation: transport.gesturePerOperation,
      },
      error: null,
    })
  } catch (error) {
    // The Hub client could not be loaded — an offline first visit, a blocked
    // CDN, a stripped bundle. Public browsing keeps working; wallet actions say
    // why they cannot start.
    return remember({
      transport: null,
      capabilities: NO_CAPABILITIES,
      error:
        error instanceof NimiqOperationError
          ? error.normalized
          : nimiqError('PROVIDER_INIT_FAILED', error),
    })
  }
}

function remember(runtime: WalletRuntime): WalletRuntime {
  cached = runtime
  return runtime
}
