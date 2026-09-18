import type { NimiqNetwork } from '@/types/domain'

import { NIMIQ_NETWORK } from './network'

/**
 * The official Nimiq Hub endpoints.
 *
 * Ref: https://nimiq.dev/hub/getting-started
 *   Mainnet  https://hub.nimiq.com
 *   Testnet  https://hub.nimiq-testnet.com
 *
 * The endpoint is chosen by the network this build is configured for, not by
 * anything the page can be told at runtime: a testnet transaction must never
 * settle a mainnet purchase, and vice versa (docs/04-NIMIQ-MINI-APPS.md §49,
 * docs/05 §92-§93, docs/09-SECURITY.md §101). The backend re-checks the network
 * of every transaction regardless; this keeps the customer from being sent to
 * the wrong wallet in the first place.
 */
export const HUB_ENDPOINTS: Record<NimiqNetwork, string> = {
  MAINNET: 'https://hub.nimiq.com',
  TESTNET: 'https://hub.nimiq-testnet.com',
}

/**
 * The Hub endpoint for a network.
 *
 * `VITE_NIMIQ_HUB_URL` overrides it, for running against a locally served Hub
 * during development. The override is deliberately ignored on mainnet: a
 * misconfigured build must not be able to route real payments through an
 * arbitrary origin, and "it was in the environment file" is not a reason to
 * trust one (docs/09-SECURITY.md §101, docs/05 §93).
 */
export function resolveHubEndpoint(
  network: NimiqNetwork = NIMIQ_NETWORK,
  raw: string | undefined = import.meta.env.VITE_NIMIQ_HUB_URL,
): string {
  const configured = raw?.trim()
  if (configured && network !== 'MAINNET' && isHttpUrl(configured)) {
    return configured.replace(/\/$/, '')
  }
  return HUB_ENDPOINTS[network]
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
