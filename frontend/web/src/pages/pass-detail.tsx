import { ArrowLeft, QrCode } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PassStatusBadge } from '@/components/pass/pass-status-badge'
import { RedemptionSheet } from '@/components/pass/redemption-sheet'
import { SessionProgress } from '@/components/pass/session-progress'
import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { SessionHistory } from '@/components/pass/session-history'
import { useSessionRedemption } from '@/hooks/use-redemption'
import { usePass, usePassRedemptions } from '@/hooks/use-passes'
import { formatDate } from '@/lib/format'
import type { Pass } from '@/types/domain'
import { isRedemptionBusy, passIsRedeemable, redemptionBlockedReason } from '@/types/redemption'

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
  const history = usePassRedemptions(id)

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
        <UseSession pass={data} />
      </Card>

      {/*
        Real session history, from `GET /passes/{passID}/redemptions`.

        Only consumed sessions appear, because only consumed sessions happened.
        The counts above and the rows here are written by the same backend
        transaction, so they cannot drift (docs/01-PRODUCT.md §27).
      */}
      <section className="mt-10 border-t border-line pt-6">
        <h2 className="text-h3 text-ink">Sessions used</h2>
        <div className="mt-4">
          <SessionHistory items={history.data} isPending={history.isPending} />
        </div>
      </section>

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
function UseSession({ pass }: { pass: Pass }) {
  const redemption = useSessionRedemption(pass)

  // Picks up an authorised challenge stranded by a reload. Read-only: it never
  // rotates a reference the customer may still be showing elsewhere (§40).
  const { recover } = redemption
  useEffect(() => {
    void recover()
  }, [recover])

  const busy = isRedemptionBusy(redemption.state)

  return (
    <>
      {passIsRedeemable(pass) ? (
        <Button
          block
          size="lg"
          loading={busy}
          disabled={busy}
          onClick={() => void redemption.begin()}
        >
          <QrCode aria-hidden="true" />
          Use a session
        </Button>
      ) : (
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
      )}

      <RedemptionSheet redemption={redemption} passId={pass.id} />
    </>
  )
}
