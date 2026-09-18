import { useQueries } from '@tanstack/react-query'

import { queryKeys, redemptionsApi } from '@/api'
import { useMyPasses } from '@/hooks/use-passes'
import { useMyPurchases } from '@/hooks/use-purchases'
import type { PurchasedPass, Purchase, RedemptionHistoryItem } from '@/types/domain'

/**
 * The customer's own timeline: what they bought, and which sessions they used.
 *
 * Both halves are real records. A purchase is a `Purchase` the backend
 * authored; a session is a `RedemptionHistoryItem` written inside the same
 * transaction that decremented the pass counter, so nothing here can disagree
 * with the numbers on the pass itself (docs/08-ARCHITECTURE.md §49).
 *
 * Nothing is predicted. There are no scheduled or upcoming entries, because
 * the contract has no appointment — Nimpass tracks the entitlement and leaves
 * scheduling to whatever the provider already uses (docs/01-PRODUCT.md §37).
 *
 * The cost is honest too: there is no customer-level redemption endpoint, so
 * one request per pass is the only way to assemble this. Passes with no used
 * session are skipped — their history is empty by definition — and a history
 * that fails to load drops out rather than failing the page.
 */
export type ActivityEvent =
  | { kind: 'purchase'; id: string; at: string; purchase: Purchase }
  | { kind: 'redemption'; id: string; at: string; redemption: RedemptionHistoryItem; pass: PurchasedPass }

export interface ActivityFeed {
  events: ActivityEvent[]
  isPending: boolean
  isError: boolean
  error: unknown
}

export function useMyActivity(): ActivityFeed {
  const purchases = useMyPurchases()
  const passes = useMyPasses()

  // Sorted so the query list is stable between renders regardless of the order
  // the pass reads happened to resolve in.
  const withHistory = (passes.data ?? [])
    .filter((pass) => pass.usedSessions > 0)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))

  const histories = useQueries({
    queries: withHistory.map((pass) => ({
      queryKey: queryKeys.redemptions.pass(pass.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        redemptionsApi.listPassRedemptions(pass.id, { signal }),
      select: (response: { items: RedemptionHistoryItem[] }) => response.items,
    })),
  })

  const events: ActivityEvent[] = []

  for (const purchase of purchases.data ?? []) {
    events.push({
      kind: 'purchase',
      id: `purchase:${purchase.purchaseIntentId}`,
      at: purchase.createdAt,
      purchase,
    })
  }

  withHistory.forEach((pass, index) => {
    for (const item of histories[index]?.data ?? []) {
      events.push({
        kind: 'redemption',
        id: `redemption:${item.redemptionId}`,
        at: item.redeemedAt,
        redemption: item,
        pass,
      })
    }
  })

  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  return {
    events,
    // The purchase list is the first hop for both halves, so its state is the
    // feed's. A pending session history only delays the session rows.
    isPending: purchases.isPending || passes.isPending || histories.some((q) => q.isPending),
    isError: purchases.isError || passes.isError,
    error: purchases.error ?? passes.error,
  }
}

/** Only the events worth putting in front of someone on My Passes. */
export function recentActivity(events: ActivityEvent[], limit: number): ActivityEvent[] {
  return events
    .filter((event) => event.kind === 'redemption' || event.purchase.purchasedPassId !== null)
    .slice(0, limit)
}
