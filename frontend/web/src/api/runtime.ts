import { APP_ENV, NIMIQ_NETWORK } from '@/lib/nimiq/network'
import { apiRequest } from './client'

/**
 * The deployment's own statement of which network and environment it serves.
 *
 * Cached for the life of the page, and deliberately so. `GET /public/config`
 * answers from process configuration — the value is fixed at the backend's
 * startup and validated there against the RPC node it talks to — so re-reading
 * it cannot produce a different answer within one session.
 *
 * It was being re-read on every wallet-sensitive operation, which put an extra
 * sequential round trip in front of *every* purchase intent and every payment
 * approval: the customer pressed Buy and waited on this before the request that
 * actually does something was even sent. On a phone over a mobile network that
 * is the difference between a press that responds and a press that appears to
 * have missed.
 *
 * Only a *successful* read is remembered. A failure — the backend is down, the
 * request was aborted — leaves the cache empty, so the next operation asks
 * again rather than inheriting a verdict from a request that never landed.
 */
let cached: Promise<void> | null = null

/** A backend outage or mismatch must stop new wallet-sensitive operations. */
export function requireBackendNetwork(): Promise<void> {
  if (cached) return cached
  const pending = readConfig()
  cached = pending
  pending.catch(() => {
    // Never cache a failure: an unreachable backend now is not a fact about
    // the deployment, and a mismatch has to be re-established rather than
    // assumed to persist.
    if (cached === pending) cached = null
  })
  return pending
}

/** Forgets the cached answer. For tests and for an explicit runtime reset. */
export function resetBackendNetworkCache(): void {
  cached = null
}

async function readConfig(): Promise<void> {
  const config = await apiRequest<{ network: string; environment: string }>('/api/v1/public/config')
  if (config.network !== NIMIQ_NETWORK || config.environment !== APP_ENV) {
    throw new Error(
      `Nimpass network mismatch. This app uses ${NIMIQ_NETWORK} (${APP_ENV}); its API uses ${config.network} (${config.environment}). Open the matching deployment.`,
    )
  }
}
