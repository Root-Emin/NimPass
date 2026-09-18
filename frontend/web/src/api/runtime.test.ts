import { afterEach, describe, expect, it, vi } from 'vitest'

import { requireBackendNetwork, resetBackendNetworkCache } from './runtime'

afterEach(() => {
  vi.unstubAllGlobals()
  resetBackendNetworkCache()
})

function config(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Whatever `@/lib/nimiq/network` resolved to for this test build. */
const { APP_ENV, NIMIQ_NETWORK } = await import('@/lib/nimiq/network')

/**
 * The deployment's network check, and why it is read once.
 *
 * It guards every wallet-sensitive operation, and it used to be an extra
 * sequential round trip in front of each one — a customer pressed Buy and
 * waited on `GET /public/config` before the request that does something was
 * even sent. On a phone over a mobile network that is the difference between a
 * press that responds and a press that looks like it missed.
 *
 * Caching it is safe because the answer cannot change within a session: the
 * backend serves it from process configuration, fixed at its own startup and
 * validated there against the RPC node it talks to.
 *
 * The one thing that must never be cached is a failure — that is the point of
 * the guard.
 */
describe('requireBackendNetwork', () => {
  it('asks once and reuses the answer', async () => {
    const fetchMock = vi.fn(async () => config({ network: NIMIQ_NETWORK, environment: APP_ENV }))
    vi.stubGlobal('fetch', fetchMock)

    await requireBackendNetwork()
    await requireBackendNetwork()
    await requireBackendNetwork()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    const fetchMock = vi.fn(async () => config({ network: NIMIQ_NETWORK, environment: APP_ENV }))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([requireBackendNetwork(), requireBackendNetwork()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never remembers an unreachable backend', async () => {
    // An outage now is not a fact about the deployment. The next wallet
    // operation has to ask again rather than inherit a verdict from a request
    // that never landed.
    let attempt = 0
    const fetchMock = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new TypeError('Failed to fetch')
      return config({ network: NIMIQ_NETWORK, environment: APP_ENV })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(requireBackendNetwork()).rejects.toThrow()
    await expect(requireBackendNetwork()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never remembers a mismatch either, and says which way round it is', async () => {
    const wrong = NIMIQ_NETWORK === 'MAINNET' ? 'TESTNET' : 'MAINNET'
    let attempt = 0
    const fetchMock = vi.fn(async () => {
      attempt += 1
      return attempt === 1
        ? config({ network: wrong, environment: APP_ENV })
        : config({ network: NIMIQ_NETWORK, environment: APP_ENV })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(requireBackendNetwork()).rejects.toThrow(/network mismatch/i)
    // A mismatch has to be re-established rather than assumed to persist: the
    // operator may have pointed the app at the right deployment since.
    await expect(requireBackendNetwork()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a backend serving a different environment', async () => {
    const wrong = APP_ENV === 'production' ? 'development' : 'production'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => config({ network: NIMIQ_NETWORK, environment: wrong })),
    )

    await expect(requireBackendNetwork()).rejects.toThrow(/network mismatch/i)
  })
})
