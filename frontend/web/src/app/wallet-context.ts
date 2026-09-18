import { createContext } from 'react'

import type { WalletState } from '@/types/wallet'

/**
 * The wallet *runtime*, and nothing more.
 *
 * It reports which transport answered — Nimiq Pay's injected provider or the
 * Nimiq Hub — and what that transport can do. Components read the capabilities,
 * never the transport name (docs/08-ARCHITECTURE.md §86).
 *
 * Account access deliberately does not live here. Revealing an address opens a
 * confirmation in both runtimes, and the only thing Nimpass does with an address
 * is turn it into a backend-verified session — so it belongs to the sign-in flow
 * in `SessionProvider`, which owns the challenge and the signature that give it
 * meaning (docs/09-SECURITY.md §11, §19). A second entry point here would be a
 * way to prompt the user for an address that authorises nothing.
 */
export interface WalletContextValue extends WalletState {
  /** Re-runs transport detection, e.g. after the user returns from Nimiq Pay. */
  refresh: () => Promise<void>
  /**
   * Records the address a *user-initiated* wallet call already revealed, so the
   * runtime can say which account answered without asking again.
   *
   * This never calls the wallet. Asking for an account opens a dialog, and page
   * load is not a reason to open one (docs/04-NIMIQ-MINI-APPS.md §55, §87,
   * docs/05-NIMIQ-PAY-INTEGRATION.md §88) — so the only honest source is a call
   * the user already approved, which today means sign-in. Null means "not
   * known in this page session", never "no account".
   */
  noteAccount: (address: string | null) => void
}

export const WalletContext = createContext<WalletContextValue | null>(null)
