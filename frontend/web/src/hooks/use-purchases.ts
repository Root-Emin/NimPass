import { useQuery } from '@tanstack/react-query'

import { purchasesApi, queryKeys } from '@/api'
import { useSession } from '@/hooks/use-session'
import type { Purchase } from '@/types/domain'

/**
 * The customer's own purchases.
 *
 * A purchase and a pass are two different records with two different
 * lifecycles, and this is the only surface that shows the first one. That
 * matters most for the outcome that produces no pass at all: a
 * `COMPENSATION_REQUIRED` purchase is a verified payment the customer needs to
 * be able to find again tomorrow, and a pass list can never show it (§29).
 *
 * Ownership is the session's; `GET /purchases` returns up to 100 of the
 * caller's newest purchases and nothing else (docs/09-SECURITY.md §32).
 */
export function useMyPurchases() {
  const { session } = useSession()

  return useQuery({
    queryKey: queryKeys.purchases.mine(),
    queryFn: ({ signal }) => purchasesApi.listMyPurchases(signal),
    enabled: Boolean(session),
    select: (response) => response.items,
  })
}

/**
 * Purchases the customer may still need to act on, or be told about.
 *
 * Deliberately narrow. A confirmed purchase is represented by its pass, a
 * cancelled or expired intent is over, and neither needs a row here. What
 * remains is the set where money may have moved and no pass exists — the cases
 * where silence looks exactly like a lost payment.
 *
 * Nothing in this list is a pass, and nothing here is ever rendered as one
 * (§28).
 */
export function needsAttention(purchases: Purchase[]): Purchase[] {
  return purchases.filter(
    (purchase) =>
      purchase.status === 'compensation_required' ||
      purchase.status === 'uncertain_retryable' ||
      purchase.status === 'awaiting_finality' ||
      purchase.status === 'verifying' ||
      purchase.status === 'transaction_submitted',
  )
}
