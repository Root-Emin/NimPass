import { useContext } from 'react'

import { WalletContext, type WalletContextValue } from '@/app/wallet-context'

/**
 * Reads the Nimiq runtime state.
 *
 * This is the only way UI code learns about the wallet — components never call
 * the SDK themselves (docs/08-ARCHITECTURE.md §85).
 */
export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used inside <WalletProvider>')
  }
  return context
}

/** True once wallet operations can actually be attempted. */
export function useWalletOperationsAvailable(): boolean {
  return useWallet().capabilities.walletOperationsAvailable
}
