import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { Page } from '@/components/layout/page'
import { PurchaseButton, PurchasePanel } from '@/components/package/purchase-panel'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { ShareButton } from '@/components/ui/share-button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { usePublicPackage } from '@/hooks/use-catalog'
import { useInView } from '@/hooks/use-in-view'
import { usePurchaseFlow, type PurchaseFlow } from '@/hooks/use-purchase-flow'
import { mayStartPayment, mustWarnAgainstSecondPayment } from '@/types/payment'
import { useWallet } from '@/hooks/use-wallet'
import { formatDate, formatNim, formatSessions, initialsOf, perSessionLuna } from '@/lib/format'
import type { PackageListing } from '@/types/domain'

/**
 * The conversion screen (docs/03-DESIGN-SYSTEM.md §42-§45).
 *
 * Desktop is two columns with the purchase panel sticky beside the content.
 * Mobile stacks, and once the panel scrolls away a sticky action bar keeps the
 * price and CTA reachable — a structural adaptation, not a squeezed desktop
 * layout (§7, §114).
 *
 * Everything here is readable without a wallet; only the CTA needs one.
 */
export function PackageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const query = usePublicPackage(id)

  if (query.isPending) return <PackageDetailSkeleton />

  if (query.isError) {
    return (
      <Page>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Page>
    )
  }

  return <PackageDetail item={query.data} />
}

function PackageDetail({ item }: { item: PackageListing }) {
  const wallet = useWallet()
  // One flow instance for the page, shared by the panel and the sticky bar.
  const flow = usePurchaseFlow(item.id)
  const { ref: panelRef, inView: panelInView } = useInView<HTMLDivElement>()
  usePurchaseRecovery(flow)

  const walletReady = wallet.capabilities.walletOperationsAvailable
  const unavailable = item.status !== 'ACTIVE'

  /*
   * The sticky bar carries a Buy button and a price, so it only earns its place
   * while one of those is still useful: a payment that can be started, or one
   * that is visibly in progress.
   *
   * Outside those, the button would render disabled and unexplained — and the
   * explanation lives in the panel the customer has just scrolled past. A dead
   * grey "Buy with NIM" pinned to the bottom of a phone screen, with a
   * compensation notice hidden above it, is exactly the reading that makes
   * someone pay again somewhere else (§46).
   */
  const showStickyBar = !panelInView && (mayStartPayment(flow.state) || flow.busy)

  useScrollToPaymentOutcome(panelRef, flow, panelInView)

  return (
    <>
      <Page className="pb-28 lg:pb-14">
        <div className="flex items-center justify-between gap-4">
          <Link
            to={`/providers/${item.provider.id}`}
            className="inline-flex items-center gap-1.5 text-small text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {item.provider.name}
          </Link>
          <ShareButton title={item.title} text={`${formatSessions(item.sessions)} on Nimpass`} />
        </div>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
          <div className="min-w-0">
            {/* No package image in the contract, so the page opens on the
                service name and the title rather than a placeholder block. */}
            <p className="text-micro font-medium uppercase tracking-[0.08em] text-ink-subtle">
              {item.service.name}
            </p>
            <h1 className="mt-3 text-h1 leading-[1.15] tracking-[-0.025em] text-ink">
              {item.title}
            </h1>

            <Link
              to={`/providers/${item.provider.id}`}
              className="mt-5 inline-flex items-center gap-2.5 rounded-md"
            >
              <Avatar className="size-9">
                <AvatarFallback className="text-micro">
                  {initialsOf(item.provider.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-body">
                <span className="block text-micro text-ink-subtle">Provided by</span>
                <span className="font-medium text-ink">{item.provider.name}</span>
              </span>
            </Link>

            {item.description ? (
              <div className="mt-8 max-w-reading">
                <h2 className="sr-only">About this package</h2>
                <p className="whitespace-pre-line text-body-lg leading-relaxed text-ink-muted">
                  {item.description}
                </p>
              </div>
            ) : null}

            <section className="mt-10 border-t border-line pt-8">
              <h2 className="text-h3 text-ink">The details</h2>
              <dl className="mt-5 grid max-w-lg grid-cols-2 gap-5 sm:grid-cols-3">
                <Detail label="Sessions" value={String(item.sessions)} />
                <Detail label="Price" value={formatNim(item.priceLuna)} />
                <Detail label="Service" value={item.service.name} />
                <Detail
                  label="Validity"
                  value={item.expirationAt ? `Until ${formatDate(item.expirationAt)}` : 'No expiry'}
                />
                <Detail
                  label="Per session"
                  value={formatNim(perSessionLuna(item.priceLuna, item.sessions) ?? 0)}
                />
              </dl>
            </section>

            <section className="mt-10 border-t border-line pt-8">
              <h2 className="text-h3 text-ink">After you buy</h2>
              <ol className="mt-5 max-w-reading space-y-5">
                {AFTER_PURCHASE.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-micro font-semibold text-accent">
                      {index + 1}
                    </span>
                    <div className="space-y-0.5">
                      <p className="text-body-lg font-medium text-ink">{step.title}</p>
                      <p className="text-body text-ink-muted">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside ref={panelRef} className="lg:sticky lg:top-24 lg:self-start">
            <PurchasePanel item={item} flow={flow} />
          </aside>
        </div>
      </Page>

      {/* Mobile action bar — appears only once the panel is off screen. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur-sm transition-transform duration-[--nimpass-duration-base] ease-[--nimpass-ease] lg:hidden ${
          showStickyBar ? 'translate-y-0' : 'translate-y-full'
        }`}
        // Keeps the bar clear of the home indicator inside the Nimiq Pay WebView.
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        // `inert` rather than aria-hidden: the bar holds a real button, and a
        // focusable control inside an aria-hidden subtree is an a11y trap.
        inert={!showStickyBar}
      >
        <div className="mx-auto flex max-w-content items-center gap-4 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-small text-ink-muted">
              {formatSessions(item.sessions)}
            </p>
            <p className="font-display text-body-lg font-semibold text-ink">
              {formatNim(item.priceLuna)}
            </p>
          </div>
          <div className="shrink-0">
            <PurchaseButton
              item={item}
              flow={flow}
              walletReady={walletReady}
              unavailable={unavailable}
              size="md"
              block={false}
            />
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Brings the purchase panel back on screen when the payment reaches an outcome
 * the customer has to read.
 *
 * On a phone the panel is a long way up the page by the time a payment settles,
 * and the states that matter most — a verified payment with no pass, a hash the
 * backend refused — are precisely the ones where saying nothing is dangerous.
 * The announcement already reaches a screen reader through the live region;
 * this is the same courtesy for everyone else.
 *
 * Scrolling rather than focusing is deliberate: the notice is not a control,
 * and pulling focus out of the page would be a worse interruption than the one
 * it solves.
 */
function useScrollToPaymentOutcome(
  panelRef: React.RefObject<HTMLElement | null>,
  flow: PurchaseFlow,
  panelInView: boolean,
) {
  const state = flow.state
  // Only for the outcomes that end the attempt while money is involved.
  const needsReading = mustWarnAgainstSecondPayment(state) && !mayStartPayment(state) && !flow.busy
  const announced = useRef<string | null>(null)

  useEffect(() => {
    if (!needsReading) {
      announced.current = null
      return
    }
    if (announced.current === state.kind) return
    announced.current = state.kind
    if (panelInView) return
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [needsReading, state.kind, panelInView, panelRef])
}

/**
 * Keeps a purchase recoverable across a refresh, a back/forward navigation and
 * a Nimiq Pay WebView reload.
 *
 * Without this the purchase id lives only in React memory, so a refresh during
 * verification drops the page back to an armed "Buy with NIM" button while a
 * transaction is still settling — the exact double-payment path
 * docs/05-NIMIQ-PAY-INTEGRATION.md §66 and §138 rule out.
 *
 * The id goes in the URL rather than storage: it survives a reload, it is
 * per-tab, and clearing browser storage cannot strip a purchase of its recovery
 * route (docs/05 §127-§128). It is only an identifier — the backend still
 * decides what that purchase is worth, so a tampered id recovers nothing
 * (docs/09-SECURITY.md §31).
 */
function usePurchaseRecovery(flow: PurchaseFlow) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlPurchaseId = searchParams.get('purchase')
  const { purchaseId, resume } = flow

  // Resume whatever the URL points at, once per id. `resume` reports IDLE for
  // an id the backend does not recognise, so a stale link is harmless.
  const resumed = useRef<string | null>(null)
  useEffect(() => {
    if (!urlPurchaseId || resumed.current === urlPurchaseId) return
    resumed.current = urlPurchaseId
    void resume(urlPurchaseId)
  }, [urlPurchaseId, resume])

  // Publish the id as soon as the intent exists, so a refresh mid-payment —
  // including one triggered by the trip out to Nimiq Pay — lands back here.
  // Replace, not push: recovery must not need a second Back press.
  useEffect(() => {
    if (!purchaseId || purchaseId === urlPurchaseId) return
    resumed.current = purchaseId
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('purchase', purchaseId)
        return next
      },
      { replace: true },
    )
  }, [purchaseId, urlPurchaseId, setSearchParams])
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-small text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-body-lg font-medium text-ink">{value}</dd>
    </div>
  )
}

/** Plain language only — no blockchain documentation (docs/03 §44). */
const AFTER_PURCHASE = [
  {
    title: 'Your pass appears in My Passes',
    body: 'All the sessions you bought, in one place, with nothing to print or remember.',
  },
  {
    title: 'Show your pass at each session',
    body: 'Your provider confirms it, and your remaining count goes down by exactly one.',
  },
  {
    title: 'Come back whenever suits you',
    body: 'Use the sessions at your own pace until the pass is finished.',
  },
] as const

function PackageDetailSkeleton() {
  return (
    <Page>
      <Skeleton className="h-4 w-40" />
      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
        <div className="space-y-6">
          <Skeleton className="aspect-[16/9] w-full rounded-lg" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-4/5" />
          <Skeleton className="h-9 w-52 rounded-full" />
          <div className="space-y-3 pt-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <Card className="space-y-4 p-6">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-12 w-full rounded-md" />
          <div className="space-y-2.5 pt-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </Card>
      </div>
    </Page>
  )
}
