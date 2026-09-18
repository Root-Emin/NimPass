import { normaliseAddress } from '@/lib/format'
import type { PassListing, PublicProvider } from '@/types/domain'

/**
 * Whether the signed-in account is the one selling this pass.
 *
 * Nimpass has one kind of account — the same wallet buys and sells — so the
 * only thing separating a customer from a provider on a pass page is whether
 * this pass came out of their own catalogue. `PublicProvider.wallet` is the
 * provider's owner login address, which is exactly the address a session
 * carries, so the comparison is between two of the same thing.
 *
 * This is presentation, not a rule. The rule is
 * `POST /api/v1/purchases` answering 403 SELF_PURCHASE_NOT_ALLOWED, decided
 * against the provider record under a lock; a hand-rolled request gets the
 * same answer as a tapped button (docs/09-SECURITY.md §11, §37). What this
 * buys is that a provider opening their own listing sees what it is rather
 * than a Buy button that cannot work.
 */
export function isOwnListing(
  provider: Pick<PublicProvider, 'wallet'> | undefined,
  viewerWallet: string | null | undefined,
): boolean {
  if (!provider?.wallet || !viewerWallet) return false
  return normaliseAddress(provider.wallet) === normaliseAddress(viewerWallet)
}

/** The same question asked of a whole listing. */
export function viewerOwnsListing(
  item: Pick<PassListing, 'provider'>,
  viewerWallet: string | null | undefined,
): boolean {
  return isOwnListing(item.provider, viewerWallet)
}
