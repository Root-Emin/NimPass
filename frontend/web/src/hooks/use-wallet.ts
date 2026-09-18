import { useContext } from 'react'

import { WalletContext, type WalletContextValue } from '@/app/wallet-context'
import { useSession } from '@/hooks/use-session'
import { normaliseAddress } from '@/lib/format'

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

/**
 * Whether the UI should offer a wallet action at all.
 *
 * Deliberately optimistic while detection is still running. Every runtime now
 * has a wallet to reach — Nimiq Pay's provider inside the host, the Nimiq Hub
 * outside it — so the honest default during `initializing` is "yes", and
 * hiding Login or Buy behind a spinner on every page load would be a worse lie
 * than the rare case of a wallet that turns out to be unreachable.
 *
 * Nothing is faked by this: pressing the control runs the real flow, and a
 * runtime that genuinely has no wallet reports that when asked
 * (docs/08-ARCHITECTURE.md §14, §87).
 */
export function useCanUseWallet(): boolean {
  const { status, capabilities } = useWallet()
  return capabilities.walletOperationsAvailable || status === 'initializing'
}

/**
 * The wallet's active account when it is *not* the one the Nimpass session was
 * issued for, and null otherwise.
 *
 * The two can drift apart: Nimiq Pay lets someone switch accounts while a
 * Nimpass session is open, and that session stays bound to the wallet it was
 * issued for. Nothing unsafe follows from that — the session identity is the
 * backend's, and every consequential operation is checked against it
 * server-side. What follows is *confusing*: a payment signed by the new account
 * fails the backend's sender check, and a redemption signature fails
 * verification, both with errors that look like bugs rather than like "you
 * switched wallets". Surfacing the drift turns a mystifying failure into an
 * obvious one-step fix.
 *
 * Compared on the normalised form, because addresses are displayed with spaces
 * and the wallet may hand them back either way.
 */
export function useActiveWalletMismatch(): string | null {
  const { account } = useWallet()
  const { session } = useSession()
  if (!session || account === null) return null
  return normaliseAddress(account) === normaliseAddress(session.identity.wallet) ? null : account
}
