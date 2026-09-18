import { ArrowLeft, ScanLine } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Page, PageHeader } from '@/components/layout/page'
import { PaymentStateView } from '@/components/payment/payment-state-view'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { useMyActivity, type ActivityEvent } from '@/hooks/use-activity'
import { usePublicProviders } from '@/hooks/use-catalog'
import { formatDateTime, formatMonth, formatNim, formatSessions } from '@/lib/format'
import { paymentStateFromPurchase } from '@/types/payment'
import type { Purchase } from '@/types/domain'

/**
 * The full log behind My Passes: every purchase in detail, and every session
 * that was used, newest first.
 *
 * This is where a purchase gets room to be a purchase. On My Passes it is one
 * line in a teaser; here it carries what was bought, what it cost, what state
 * the payment ended in and what it produced — which is the record a customer
 * needs when they are trying to reconcile a payment weeks later (§59, §122).
 *
 * Every purchase appears, including the ones that produced nothing. A purchase
 * that was cancelled or that expired is part of the account's history, and
 * hiding it would make the log look edited (docs/01-PRODUCT.md §28).
 *
 * The log is entirely retrospective. There is no "upcoming" section because
 * there is no appointment in the contract to put in one (§37).
 */
export function PassHistoryPage() {
  const activity = useMyActivity()

  // Only purchases need a lookup. A session row carries the pass it came from,
  // and the pass carries the provider name it was bought under — so a renamed
  // provider cannot rewrite an old row, and the page fetches less.
  const providerNames = usePublicProviders(
    activity.events.flatMap((event) =>
      event.kind === 'purchase' ? [event.purchase.providerId] : [],
    ),
  )

  return (
    <Page width="reading">
      <Link
        to="/passes"
        className="inline-flex min-h-11 sm:min-h-0 items-center gap-1.5 text-small text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        My Passes
      </Link>

      <PageHeader
        className="mt-6"
        title="History"
        description="Everything you've bought, and every session you've used."
      />

      <div className="mt-10">
        {activity.isPending ? (
          <HistorySkeleton />
        ) : activity.isError ? (
          <ErrorState error={activity.error} />
        ) : activity.events.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="Once you buy a pass, the purchase and every session you use will be listed here."
            action={
              <Button asChild>
                <Link to="/discover">Discover</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-12">
            {groupByMonth(activity.events).map(([month, events]) => (
              <section key={month}>
                <h2 className="eyebrow border-b border-line pb-3 text-ink-subtle">{month}</h2>
                <ul className="mt-6 space-y-4">
                  {events.map((event) => (
                    <li key={event.id}>
                      {event.kind === 'purchase' ? (
                        <PurchaseEntry
                          purchase={event.purchase}
                          providerName={providerNames[event.purchase.providerId]}
                        />
                      ) : (
                        <SessionEntry event={event} providerName={event.pass.providerName} />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Page>
  )
}

/**
 * One purchase, in full.
 *
 * The payment state comes from `PaymentStateView` — the same component the
 * purchase flow itself uses — so a compensation case reads identically here and
 * three days after it happened, and this page never re-words an outcome
 * (docs/05-NIMIQ-PAY-INTEGRATION.md §62).
 */
function PurchaseEntry({
  purchase,
  providerName,
}: {
  purchase: Purchase
  providerName?: string
}) {
  return (
    <Card variant="plain" className="rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1.5">
        <h3 className="min-w-0 text-body-lg font-medium text-ink">{purchase.passTitle}</h3>
        <p className="numeric font-display text-body-lg font-semibold text-ink">
          {formatNim(purchase.priceLuna)}
        </p>
      </div>

      <p className="mt-1.5 text-small text-ink-subtle">
        {[providerName, formatSessions(purchase.sessions), formatDateTime(purchase.createdAt)]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <PaymentStateView className="mt-4" state={paymentStateFromPurchase(purchase)} />

      <div className="mt-4 flex flex-wrap gap-2">
        {purchase.purchasedPassId ? (
          <Button asChild size="sm" variant="secondary">
            <Link to={`/passes/${purchase.purchasedPassId}`}>Open pass</Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="ghost">
          {/* Back to the purchase with recovery intact: the pass page reads
              this id from the URL and re-reads the authoritative state rather
              than trusting anything rendered here. */}
          <Link to={`/pass/${purchase.passId}?purchase=${purchase.purchaseIntentId}`}>
            {purchase.purchasedPassId ? 'View pass' : 'Open this purchase'}
          </Link>
        </Button>
      </div>
    </Card>
  )
}

/** One consumed session. Compact: the pass it belongs to carries the detail. */
function SessionEntry({
  event,
  providerName,
}: {
  event: Extract<ActivityEvent, { kind: 'redemption' }>
  providerName?: string
}) {
  return (
    <Link
      to={`/passes/${event.pass.id}`}
      className="flex items-center justify-between gap-5 rounded-2xl px-5 py-4 transition-colors hover:bg-surface-muted"
    >
      <span className="flex min-w-0 items-center gap-3.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
        >
          <ScanLine className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-body font-medium text-ink">
            Session {event.redemption.sessionOrdinal} of {event.pass.originalSessions}
          </span>
          <span className="mt-0.5 block truncate text-small text-ink-subtle">
            {[event.pass.passTitle, providerName].filter(Boolean).join(' · ')}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-right text-small text-ink-muted">
        {formatDateTime(event.at)}
      </span>
    </Link>
  )
}

/**
 * Newest month first, and the events inside each month stay in the order the
 * feed already sorted them into.
 */
function groupByMonth(events: ActivityEvent[]): [string, ActivityEvent[]][] {
  const groups = new Map<string, ActivityEvent[]>()
  for (const event of events) {
    const month = formatMonth(event.at)
    const bucket = groups.get(month)
    if (bucket) bucket.push(event)
    else groups.set(month, [event])
  }
  return [...groups.entries()]
}

function HistorySkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-32 rounded-2xl" />
      ))}
    </div>
  )
}
