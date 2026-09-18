import { ArrowLeft, QrCode } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PassSurface } from '@/components/pass/pass-surface'
import { RedemptionSheet } from '@/components/pass/redemption-sheet'
import { SessionTimeline } from '@/components/pass/session-timeline'
import { Page, Subsection } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { usePassCover } from '@/hooks/use-pass-cover'
import { usePassSessions, useSessionActions } from '@/hooks/use-pass-sessions'
import { useSessionRedemption } from '@/hooks/use-redemption'
import { usePass } from '@/hooks/use-passes'
import { formatDate, formatNim, shortenId } from '@/lib/format'
import { providerPath } from '@/lib/provider-url'
import type { PurchasedPass, PurchasedPassStatus } from '@/types/domain'
import { isRedemptionBusy, passIsRedeemable, redemptionBlockedReason } from '@/types/redemption'

/**
 * The pass itself: what it is, how much is left, when each session was used,
 * and how to use another one.
 *
 * The screen is built around a single object (docs/03-DESIGN-SYSTEM.md §50).
 * The name and the provider stand above it, the pass surface carries the
 * remaining count and the action, and everything else — the facts panel, the
 * timeline — is supporting material beside and below it.
 *
 * The remaining count is rendered straight from the backend and is never
 * adjusted locally after a redemption (docs/08-ARCHITECTURE.md §49).
 *
 * Everything named here is a purchased snapshot on the pass itself — live
 * title, service name, provider name and the price actually paid — so the page
 * reads what was bought rather than what the provider's record says today, and
 * one request answers the whole header (docs/08-ARCHITECTURE.md §41).
 *
 * The page is shared. Its two readers are the customer who bought the pass and
 * the provider who has to deliver it, and `viewerRole` — the backend's answer,
 * never a guess made here — decides which controls appear. The record, the
 * counters and the sessions are identical for both.
 *
 * Sessions now carry dates. That is a deliberate narrowing of
 * docs/01-PRODUCT.md §37, which says Nimpass is not primarily a booking
 * system: it still is not one. There is no calendar, no availability, no
 * reminders and no bookings — each session of an already-purchased pass can
 * simply record when it is meant to happen, so that "which session was that?"
 * has an answer on both screens.
 */
export function PassDetailPage() {
  const { id } = useParams<{ id: string }>()
  const pass = usePass(id)
  const sessions = usePassSessions(id)
  const sessionActions = useSessionActions(id)

  if (pass.isPending) return <PassDetailSkeleton />

  if (pass.isError) {
    return (
      <Page width="content">
        <ErrorState error={pass.error} onRetry={() => void pass.refetch()} />
      </Page>
    )
  }

  const data = pass.data
  const providerName = data.providerName
  const paidLuna = data.priceLuna
  // Which party is reading. The backend decides it; this page only renders it.
  const role = sessions.data?.role ?? data.viewerRole
  const isProvider = role === 'PROVIDER'

  return (
    <Page width="content">
      {/* Back to wherever this pass is part of *your* collection: the
          customer's passes, or the provider's store. */}
      <Link
        to={isProvider ? '/my-store' : '/passes'}
        className="inline-flex min-h-11 sm:min-h-0 items-center gap-1.5 text-small text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {isProvider ? 'My Store' : 'My Passes'}
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_288px] lg:gap-14">
        <div className="min-w-0">
          <header>
            <p className="eyebrow text-ink-subtle">Nimpass · {STANDING[data.status]}</p>
            <h1 className="mt-3 text-h1 text-ink">{data.passTitle}</h1>
            {providerName ? (
              <p className="mt-2 text-body-lg text-ink-muted">
                with{' '}
                <Link
                  to={providerPath({ id: data.providerId })}
                  className="text-ink underline-offset-4 hover:underline"
                >
                  {providerName}
                </Link>
              </p>
            ) : null}
          </header>

          <div className="mt-7">
            {isProvider ? <ProviderStanding pass={data} /> : <UseSession pass={data} />}
          </div>

          {/*
            Every session of the pass, not only the used ones.

            The old list read `GET /passes/{passID}/redemptions`, which can only
            show sessions that already happened — so a pass with seven left
            showed nothing about them. These rows are the sessions themselves,
            written in the same backend transaction as the counters above, so
            the two cannot drift (docs/01-PRODUCT.md §27).
          */}
          <Subsection
            title="Sessions"
            action={
              <span className="text-small text-ink-subtle">
                {data.usedSessions} of {data.originalSessions} done
              </span>
            }
          >
            <SessionTimeline
              sessions={sessions.data?.items}
              role={role}
              actions={sessionActions}
              isPending={sessions.isPending}
              passIsActive={data.status === 'ACTIVE'}
            />
          </Subsection>
        </div>

        {/* Secondary detail (§54 progressive disclosure): these facts matter,
            but not as much as what is left on the pass. */}
        <aside className="lg:pt-1">
          <h2 className="eyebrow text-ink-subtle">Pass details</h2>

          <dl className="mt-4 divide-y divide-line border-t border-line">
            <Detail label="Provider" value={providerName} />
            <Detail label="Service" value={data.serviceName} />
            <Detail
              label="Sessions"
              value={`${data.usedSessions} used of ${data.originalSessions}`}
            />
            <Detail label="Purchased" value={formatDate(data.createdAt)} />
            <Detail label="Paid" value={formatNim(paidLuna)} />
            {data.expiresAt ? (
              <Detail label="Valid until" value={formatDate(data.expiresAt)} />
            ) : null}
            <Detail
              label="Pass"
              value={
                <span className="numeric" title={data.id}>
                  {shortenId(data.id)}
                </span>
              }
            />
          </dl>

          {/* How the two sides are meant to use the timeline above. */}
          <p className="mt-5 text-small leading-relaxed text-ink-subtle">
            {isProvider
              ? 'You and your customer see the same sessions. Give a session a date when you agree one, and mark it done once it has happened — the remaining count moves with it.'
              : `Give a session a date when you and ${providerName} agree one. A session counts as used when you authorise it in your wallet, or when ${providerName} marks it done.`}
          </p>
        </aside>
      </div>
    </Page>
  )
}

/** The status word in the standing line. Never colour alone (§19). */
const STANDING: Record<PurchasedPassStatus, string> = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-small text-ink-subtle">{label}</dt>
      <dd className="text-right text-body text-ink">{value}</dd>
    </div>
  )
}

/**
 * The provider's view of the pass surface.
 *
 * Same object, no redemption control: a provider cannot spend somebody else's
 * pass by pressing a button, and the backend would refuse it. What they get
 * instead is the standing of the entitlement they owe, and the per-session
 * controls in the timeline below.
 */
function ProviderStanding({ pass }: { pass: PurchasedPass }) {
  const coverSrc = usePassCover(pass)
  return (
    <PassSurface
      pass={pass}
      coverSrc={coverSrc}
      footnote={
        pass.status === 'ACTIVE'
          ? `${pass.remainingSessions} of ${pass.originalSessions} sessions still to deliver.`
          : 'This pass is finished. Nothing further is owed on it.'
      }
    />
  )
}

/**
 * The redemption surface.
 *
 * The hook and the sheet live *here*, above the redeemable/not-redeemable
 * branch, and that placement is load-bearing rather than tidy.
 *
 * When a provider confirms the last session, the pass becomes COMPLETED and
 * `passIsRedeemable` flips to false. With the sheet mounted inside the
 * redeemable branch, that unmounted the dialog at the exact moment it had
 * something worth saying — the customer watched their final session confirm and
 * then saw the screen silently close. Keeping the sheet outside the branch
 * means the outcome survives the state change that caused it.
 */
function UseSession({ pass }: { pass: PurchasedPass }) {
  const redemption = useSessionRedemption(pass)
  // Optional artwork, resolved from the catalog Pass this one was bought from.
  const coverSrc = usePassCover(pass)

  // Picks up an authorised challenge stranded by a reload. Read-only: it never
  // rotates a reference the customer may still be showing elsewhere (§40).
  const { recover } = redemption
  useEffect(() => {
    void recover()
  }, [recover])

  const busy = isRedemptionBusy(redemption.state)
  const redeemable = passIsRedeemable(pass)

  return (
    <>
      <PassSurface
        pass={pass}
        coverSrc={coverSrc}
        action={
          redeemable ? (
            <Button
              size="xl"
              variant="onPass"
              loading={busy}
              disabled={busy}
              onClick={() => void redemption.begin()}
            >
              <QrCode aria-hidden="true" />
              Use a session
            </Button>
          ) : pass.status === 'COMPLETED' ? (
            <Button asChild variant="secondary" size="lg">
              {/* Buy Again always goes to the live pass, on today's terms
                  (docs/01-PRODUCT.md §19, §56). */}
              <Link to={`/pass/${pass.passId}`}>Buy again</Link>
            </Button>
          ) : null
        }
        footnote={
          redeemable
            ? 'You authorise it, your provider confirms it. One session at a time.'
            : (redemptionBlockedReason(pass) ?? 'This pass cannot be used right now.')
        }
      />

      <RedemptionSheet redemption={redemption} passId={pass.id} />
    </>
  )
}

function PassDetailSkeleton() {
  return (
    <Page width="content">
      <Skeleton className="h-4 w-28" />
      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_288px] lg:gap-14">
        <div className="space-y-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-80 rounded-3xl" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </Page>
  )
}
