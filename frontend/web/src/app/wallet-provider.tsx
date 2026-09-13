import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { WalletContext, type WalletContextValue } from '@/app/wallet-context'
import { NIMIQ_NETWORK, initNimiq, isInsideNimiqPay } from '@/lib/nimiq'
import type { WalletState } from '@/types/wallet'
import { NO_CAPABILITIES } from '@/types/wallet'

/**
 * Nimiq Pay seeds its host context synchronously before the Mini App's page
 * script runs, so its absence is a reliable same-tick signal that no wallet is
 * coming. Starting as `unavailable` outside Nimiq Pay keeps ordinary browsers
 * from staring at a wallet spinner for the whole init timeout; detection still
 * runs underneath and upgrades the state if a provider does appear.
 */
function initialState(): WalletState {
  return {
    status: isInsideNimiqPay() ? 'initializing' : 'unavailable',
    capabilities: NO_CAPABILITIES,
    network: NIMIQ_NETWORK,
    account: null,
    error: null,
  }
}

/**
 * Detects the Nimiq runtime once and exposes it as state.
 *
 * Detection is silent and non-blocking: public browsing must work while this
 * resolves, and "no provider" is a normal outcome rather than an error
 * (docs/04-NIMIQ-MINI-APPS.md §12, docs/08-ARCHITECTURE.md §87).
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(initialState)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const detect = useCallback(async () => {
    const result = await initNimiq()
    if (!mounted.current) return
    setState((previous) => ({
      ...previous,
      status: result.provider ? 'ready' : result.error ? 'error' : 'unavailable',
      capabilities: result.capabilities,
      error: result.error,
    }))
  }, [])

  useEffect(() => {
    void detect()
  }, [detect])

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, refresh: detect }),
    [state, detect],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
