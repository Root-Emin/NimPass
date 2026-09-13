import { ArrowLeft, QrCode } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { PassStatusBadge } from '@/components/pass/pass-status-badge'
import { RedemptionSheet } from '@/components/pass/redemption-sheet'
import { SessionProgress } from '@/components/pass/session-progress'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useSessionRedemption } from '@/hooks/use-redemption'
import { usePass } from '@/hooks/use-passes'
import { formatDate } from '@/lib/format'
import type { Pass } from '@/types/domain'
import { passIsRedeemable, redemptionBlockedReason } from '@/types/redemption'

/**
 * The pass itself: what it is, how much is left, and how to use one session.
 *
 * The remaining count is rendered straight from the backend and is never
 * adjusted locally after a redemption (docs/08-ARCHITECTURE.md §49).
 *
 * The contract's `Pass` carries the package title it was sold under plus ids —
 * there is no service name, provider name or price on it. The page therefore
 * leads with the package and links to the provider by id, rather than
 * displaying a name it has not been given (docs/08-ARCHITECTURE.md §11).
 */
export function PassDetailPage() {
  const { id } = useParams<{ id: string }>()
  const pass = usePass(id)

  if (pass.isPending) {
    return (
      <Page width="reading">
        <LoadingState label="Loading pass…" />
      </Page>
    )
  }

  if (pass.isError) {
    return (
      <Page width="reading">
        <ErrorState error={pass.error} onRetry={() => void pass.refetch()} />
      </Page>
    )
  }

  const data = pass.data

  return (
    <Page width="reading">
      <Link
        to="/passes"
        className="inline-flex items-center gap-1.5 text-small text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        My Passes
      </Link>

      <header className="mt-6 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="text-h1 text-ink">{data.packageTitle}</h1>
          <Link
            to={`/providers/${data.providerId}`}
            className="inline-block text-body text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            View the provider
          </Link>
        </div>
        <PassStatusBadge status={data.status} />
      </header>

      <Card className="mt-8 p-5 sm:p-6">
        <SessionProgress pass={data} />
        <Separator className="my-5" />
        <UseSessionAction pass={data} />
      </Card>

      {/*
        No session history.

        `backend/openapi.yaml` has no history endpoint, and the Pass it returns
        carries counts rather than events. Listing anything here would mean
        inventing a timeline, so the page says what it knows — how many sessions
        have been used — and nothing more. docs/01-PRODUCT.md §27 wants the full
        history; it needs a backend source first.
      */}
      <section className="mt-10 border-t border-line pt-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-small text-ink-subtle">Purchased</dt>
            <dd className="mt-0.5 text-body text-ink">{formatDate(data.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-subtle">Expires</dt>
            <dd className="mt-0.5 text-body text-ink">
              {data.expiresAt ? formatDate(data.expiresAt) : 'No expiry'}
            </dd>
          </div>
        </dl>
      </section>
    </Page>
  )
}

/**
 * "Use session" produces a short-lived challenge for the provider to validate.
 *
 * It never decrements anything on its own: the remaining count on screen is
 * whatever the backend last reported (docs/08-ARCHITECTURE.md §49).
 */
function UseSessionAction({ pass }: { pass: Pass }) {
  const redemption = useSessionRedemption(pass)

  if (!passIsRedeemable(pass)) {
    return (
      <div className="space-y-3">
        <p className="text-body text-ink-muted">
          {redemptionBlockedReason(pass) ?? 'This pass cannot be used right now.'}
        </p>
        {pass.status === 'COMPLETED' ? (
          <Button asChild variant="secondary">
            {/* Buy Again always goes to the live package, on today's terms
                (docs/01-PRODUCT.md §19, §56). */}
            <Link to={`/packages/${pass.packageId}`}>Buy again</Link>
          </Button>
        ) : null}
      </div>
    )
  }

  const busy = redemption.state.kind === 'REQUESTING'

  return (
    <>
      <Button block size="lg" loading={busy} onClick={() => void redemption.begin()}>
        <QrCode aria-hidden="true" />
        Use a session
      </Button>

      <RedemptionSheet redemption={redemption} />
    </>
  )
}
