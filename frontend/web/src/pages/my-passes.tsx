import { Link } from 'react-router-dom'

import { Page, PageHeader, Subsection } from '@/components/layout/page'
import { ActivityList } from '@/components/pass/activity-list'
import { PassCard, PassCardSkeleton } from '@/components/pass/pass-card'
import { PurchaseAttentionList } from '@/components/payment/purchase-attention-list'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { recentActivity, useMyActivity } from '@/hooks/use-activity'
import { usePublicProviders } from '@/hooks/use-catalog'
import { usePassCovers } from '@/hooks/use-pass-cover'
import { useMyPasses } from '@/hooks/use-passes'
import { needsAttention, useMyPurchases } from '@/hooks/use-purchases'
import type { PurchasedPass } from '@/types/domain'

/**
 * The customer's home base (docs/03-DESIGN-SYSTEM.md §48) — a collection of
 * objects the customer owns, not an analytics dashboard.
 *
 * Three bands, in the order someone actually cares about them: the passes they
 * can use today, what has happened lately, and the passes that are finished.
 * Grouped rather than tabbed — what is usable should not be one click away
 * (§48, §107 on unnecessary tabs).
 *
 * Passes are private, so this is the first screen that genuinely needs a
 * wallet. The route guard decides that before the page renders
 * (`RequireSession`, docs/09-SECURITY.md §32, §36) — reaching this component
 * means the backend has confirmed a session.
 */
const RECENT_ACTIVITY_ROWS = 3

export function MyPassesPage() {
  const passes = useMyPasses()
  // Purchases that produced no pass. A compensation case lives only here, so
  // this list is the difference between a verified payment the customer can
  // still see and one that silently disappeared from the app (§28, §29).
  const purchases = useMyPurchases()
  const activity = useMyActivity()

  const items = passes.data ?? []
  // The artwork each pass was bought wearing. Optional, cached, and shared with
  // every other surface that shows the same pass.
  const covers = usePassCovers(items.map((pass) => pass.passId))
  const unresolved = purchases.data ? needsAttention(purchases.data) : []
  // Only purchases still need a name resolved: a pass carries `providerName`
  // as a purchased snapshot, a `Purchase` does not.
  const providerNames = usePublicProviders(
    (purchases.data ?? []).map((purchase) => purchase.providerId),
  )

  const active = items.filter((pass) => pass.status === 'ACTIVE')
  const finished = items.filter((pass) => pass.status !== 'ACTIVE')
  const recent = recentActivity(activity.events, RECENT_ACTIVITY_ROWS)

  const nothingToShow = items.length === 0 && unresolved.length === 0

  return (
    <Page>
      <PageHeader title="My Passes" description={summaryLine(active)} />

      <div className="mt-10">
        {passes.isPending ? (
          <PassGridSkeleton />
        ) : passes.isError ? (
          <ErrorState error={passes.error} onRetry={() => void passes.refetch()} />
        ) : nothingToShow ? (
          <EmptyState
            title="No passes yet"
            description="When you buy a session pass, your pass will appear here."
            action={
              <Button asChild>
                <Link to="/discover">Discover</Link>
              </Button>
            }
          />
        ) : (
          <>
            <PurchaseAttentionList purchases={unresolved} />

            {active.length > 0 ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {active.map((pass) => (
                  <PassCard key={pass.id} pass={pass} coverSrc={covers[pass.passId] ?? null} />
                ))}
              </div>
            ) : null}

            {/*
              The account's own timeline. The link beside the heading is the way
              into the full log — a teaser that cannot be expanded is just a
              truncated list (§54 progressive disclosure).
            */}
            <Subsection
              title="Recent activity"
              action={
                <Link
                  to="/passes/history"
                  className="inline-flex min-h-11 items-center text-small font-medium text-accent underline-offset-4 hover:underline sm:min-h-0"
                >
                  View history
                </Link>
              }
            >
              <ActivityList
                events={recent}
                providerNames={providerNames}
                isPending={activity.isPending}
              />
            </Subsection>

            {/*
              Finished passes, as cards rather than as a list of rows. They are
              still objects the customer owns and still carry their own cover,
              so they belong in the collection — just not at the weight of a
              pass that can be used today (§60).
            */}
            {finished.length > 0 ? (
              <Subsection title="Completed">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {finished.map((pass) => (
                    <PassCard key={pass.id} pass={pass} coverSrc={covers[pass.passId] ?? null} />
                  ))}
                </div>
              </Subsection>
            ) : null}

            {/*
              `GET /passes` is paged, so the collection can be longer than what
              arrived. The button says so plainly rather than letting the list
              end silently at the page boundary — the old version could not show
              a pass at all once it fell outside the newest hundred purchases.
            */}
            {passes.hasMore ? (
              <div className="mt-8 flex justify-center">
                <Button
                  variant="secondary"
                  onClick={passes.loadMore}
                  loading={passes.isLoadingMore}
                  disabled={passes.isLoadingMore}
                >
                  {passes.isLoadingMore ? 'Loading…' : 'Load more passes'}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Page>
  )
}

/**
 * The line under the title.
 *
 * A sum of counts the backend reported, labelled as exactly that. It is not a
 * balance, a forecast or a score (§48 — this is not a dashboard).
 */
function summaryLine(active: PurchasedPass[]): string {
  if (active.length === 0) return "Every pass you've bought, and what's left on it."

  const remaining = active.reduce((total, pass) => total + pass.remainingSessions, 0)
  const passWord = active.length === 1 ? 'pass' : 'passes'
  const sessionWord = remaining === 1 ? 'session' : 'sessions'
  return `${active.length} active ${passWord} · ${remaining} ${sessionWord} remaining in total`
}

function PassGridSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <PassCardSkeleton />
      <PassCardSkeleton />
    </div>
  )
}
