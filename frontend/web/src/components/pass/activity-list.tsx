import { CircleAlert, ScanLine, Ticket, XCircle, type LucideIcon } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatNim } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ActivityEvent } from '@/hooks/use-activity'
import type { Purchase } from '@/types/domain'

/**
 * What has happened on this account, newest first.
 *
 * A list, not a chart: history here exists for trust rather than analysis
 * (docs/03-DESIGN-SYSTEM.md §59). Two kinds of row, both drawn from records the
 * backend authored — a purchase, and a session a provider confirmed.
 *
 * There are no upcoming rows. Nimpass tracks entitlement, not appointments, and
 * the contract has no scheduled session to render (docs/01-PRODUCT.md §37).
 */
export function ActivityList({
  events,
  providerNames,
  isPending,
  className,
}: {
  events: ActivityEvent[]
  /** Provider id → name, for the rows that can be attributed. */
  providerNames: Record<string, string>
  isPending: boolean
  className?: string
}) {
  if (isPending) {
    return (
      <div className={cn('space-y-4', className)}>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-12 rounded-lg" />
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <p className={cn('text-body text-ink-muted', className)}>
        Nothing here yet. Your purchases and the sessions you use will appear here.
      </p>
    )
  }

  return (
    <ul className={cn('divide-y divide-line border-t border-line', className)}>
      {events.map((event) => (
        <ActivityRow key={event.id} event={event} providerNames={providerNames} />
      ))}
    </ul>
  )
}

function ActivityRow({
  event,
  providerNames,
}: {
  event: ActivityEvent
  providerNames: Record<string, string>
}) {
  const view =
    event.kind === 'redemption'
      ? {
          icon: ScanLine,
          tone: 'accent' as const,
          title: 'Session used',
          subtitle: [event.pass.passTitle, providerNames[event.redemption.providerId]]
            .filter(Boolean)
            .join(' · '),
          // The ordinal and the original count are both the backend's. Nothing
          // here subtracts one from the other to guess a remaining balance
          // (docs/08-ARCHITECTURE.md §49).
          detail: `Session ${event.redemption.sessionOrdinal} of ${event.pass.originalSessions}`,
        }
      : {
          ...purchaseView(event.purchase),
          subtitle: [event.purchase.passTitle, providerNames[event.purchase.providerId]]
            .filter(Boolean)
            .join(' · '),
          detail: `${event.purchase.sessions} sessions · ${formatNim(event.purchase.priceLuna)}`,
        }

  return (
    <li className="flex items-start justify-between gap-5 py-4">
      <div className="flex min-w-0 gap-3.5">
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
            view.tone === 'accent' && 'bg-accent-soft text-accent',
            view.tone === 'neutral' && 'bg-surface-inset text-ink-muted',
            view.tone === 'warning' && 'bg-warning-soft text-warning',
          )}
        >
          <view.icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-body font-medium text-ink">{view.title}</p>
          {view.subtitle ? (
            <p className="mt-0.5 truncate text-small text-ink-subtle">{view.subtitle}</p>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-small text-ink-muted">{formatDateTime(event.at)}</p>
        <p className="mt-0.5 text-small text-ink-subtle">{view.detail}</p>
      </div>
    </li>
  )
}

/**
 * How a purchase reads once it is history.
 *
 * A purchase that produced a pass is the ordinary case. The rest are named for
 * what they are rather than collapsed into "failed": a compensation case in
 * particular is a *verified payment*, and must never read as money lost
 * (docs/01-PRODUCT.md §28-§29).
 */
function purchaseView(purchase: Purchase): {
  icon: LucideIcon
  tone: 'accent' | 'neutral' | 'warning'
  title: string
} {
  if (purchase.purchasedPassId !== null) {
    return { icon: Ticket, tone: 'accent', title: 'Pass purchased' }
  }

  switch (purchase.status) {
    case 'compensation_required':
      return { icon: CircleAlert, tone: 'warning', title: 'Payment being resolved' }
    case 'cancelled':
      return { icon: XCircle, tone: 'neutral', title: 'Purchase cancelled' }
    case 'expired':
      return { icon: XCircle, tone: 'neutral', title: 'Purchase expired' }
    case 'permanently_failed':
      return { icon: XCircle, tone: 'neutral', title: 'Purchase failed' }
    default:
      return { icon: Ticket, tone: 'neutral', title: 'Purchase started' }
  }
}
