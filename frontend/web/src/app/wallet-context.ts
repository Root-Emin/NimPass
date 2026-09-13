import { createContext } from 'react'

import type { WalletState } from '@/types/wallet'

/**
 * The wallet *runtime*, and nothing more.
 *
 * Account access deliberately does not live here. `listAccounts()` opens a
 * native dialog, and the only thing Nimpass does with an address is turn it
 * into a backend-verified session — so it belongs to the sign-in flow in
 * `SessionProvider`, which owns the challenge and the signature that give it
 * meaning (docs/09-SECURITY.md §11, §19). A second entry point here would be a
 * way to prompt the user for an address that authorises nothing.
 */
export interface WalletContextValue extends WalletState {
  /** Re-runs capability detection, e.g. after the user returns from Nimiq Pay. */
  refresh: () => Promise<void>
}

export const WalletContext = createContext<WalletContextValue | null>(null)
