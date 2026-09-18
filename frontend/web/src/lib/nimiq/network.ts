import { deployment } from '../../../config/deployment'

import type { NimiqNetwork } from '@/types/domain'

/**
 * The Nimiq network this build talks to, resolved once from configuration.
 *
 * Values are spelled the way the backend spells them (`domain.NimiqNetwork`:
 * `MAINNET` / `TESTNET`). Network must be explicit — a testnet transaction is
 * never a mainnet purchase (docs/04-NIMIQ-MINI-APPS.md §49).
 *
 * Note that Nimiq Pay chooses its own network: the wallet has a hidden dev menu
 * (long-press settings for 10 seconds) with Default / Mainnet / Testnet, and the
 * switch affects Nimiq provider operations only.
 * Ref: https://nimiq.dev/mini-apps/development/load-local-mini-app
 *
 * This setting therefore describes which network *Nimpass* is configured for.
 * It is used to refuse a purchase intent issued for a different network; the
 * authoritative network of a transaction is verified by the backend.
 */
export function resolveNetwork(
  raw: string | undefined = import.meta.env.VITE_NIMIQ_NETWORK,
): NimiqNetwork {
  if (raw === 'MAINNET' || raw === 'TESTNET') return raw
  throw new Error('VITE_NIMIQ_NETWORK must explicitly be MAINNET or TESTNET.')
}

const configured = deployment(import.meta.env.VITE_NIMIQ_NETWORK, import.meta.env.VITE_APP_ENV)
export const NIMIQ_NETWORK: NimiqNetwork = configured.network
export const APP_ENV = configured.environment

export const IS_MAINNET = NIMIQ_NETWORK === 'MAINNET'

/** Short label for the few places where the network is worth showing at all. */
export function networkLabel(network: NimiqNetwork = NIMIQ_NETWORK): string {
  return network === 'MAINNET' ? 'Nimiq Mainnet' : 'Nimiq Testnet'
}

/**
 * How long to wait for Nimiq Pay to inject the provider.
 *
 * `init()` accepts an optional `timeout` (the SDK's `InitOptions`). The official
 * FAQ lists "the request times out" among the ways a provider call can fail and
 * asks that such cases be shown to the user rather than left hanging, so the
 * bound is explicit here instead of waiting indefinitely.
 * Ref: https://nimiq.dev/mini-apps/faq
 */
export function resolveInitTimeoutMs(
  raw: string | undefined = import.meta.env.VITE_NIMIQ_INIT_TIMEOUT_MS,
): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 3000
}
