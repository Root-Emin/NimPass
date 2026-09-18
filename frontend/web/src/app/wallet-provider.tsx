import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { WalletContext, type WalletContextValue } from '@/app/wallet-context'
import { NIMIQ_NETWORK, initWalletRuntime, resetWalletRuntime } from '@/lib/nimiq'
import type { WalletState } from '@/types/wallet'
import { NO_CAPABILITIES } from '@/types/wallet'

/**
 * Resolves the wallet runtime once and exposes it as state.
 *
 * Every runtime starts as `initializing`, because every runtime now has a
 * wallet to find: Nimiq Pay's injected provider inside the host, the Nimiq Hub
 * outside it. Resolution is silent and non-blocking — public browsing works
 * while it settles, and "no wallet" remains a normal outcome rather than an
 * error (docs/04-NIMIQ-MINI-APPS.md §12, docs/08-ARCHITECTURE.md §87).
 *
 * Resolving on mount rather than on demand is deliberate. The Hub opens a
 * browser popup, browsers only allow that during a click, and loading the Hub
 * client is an `await` — so the module has to already be there when the button
 * is pressed. Doing this work up front is what makes the first Login click open
 * a window instead of being swallowed
 * (https://nimiq.dev/hub/getting-started).
 *
 * Nothing here asks the wallet for an account. That opens a dialog in both
 * runtimes, and a page load is not a reason to open one (docs/04 §55).
 */
function initialState(): WalletState {
  return {
    status: 'initializing',
    capabilities: NO_CAPABILITIES,
    network: NIMIQ_NETWORK,
    account: null,
    error: null,
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(initialState)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const apply = useCallback(async () => {
    const runtime = await initWalletRuntime()
    if (!mounted.current) return
    setState((previous) => ({
      ...previous,
      status: runtime.transport ? 'ready' : runtime.error ? 'error' : 'unavailable',
      capabilities: runtime.capabilities,
      error: runtime.error,
    }))
  }, [])

  const detect = useCallback(async () => {
    await apply()
  }, [apply])

  const refresh = useCallback(async () => {
    // A retry has to actually retry: the resolved runtime is cached, so a
    // "Try again" that reused it would always report the same failure.
    resetWalletRuntime()
    if (mounted.current) setState((previous) => ({ ...previous, status: 'initializing', error: null }))
    await apply()
  }, [apply])

  useEffect(() => {
    void detect()
  }, [detect])

  const noteAccount = useCallback((address: string | null) => {
    if (!mounted.current) return
    setState((previous) => (previous.account === address ? previous : { ...previous, account: address }))
  }, [])

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, refresh, noteAccount }),
    [state, refresh, noteAccount],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
