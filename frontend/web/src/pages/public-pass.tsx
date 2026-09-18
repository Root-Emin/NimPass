import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { Page } from '@/components/layout/page'
import { PassFacts } from '@/components/catalog/pass-facts'
import { PurchaseButton, PurchasePanel } from '@/components/catalog/purchase-panel'
import { PassCoverArt } from '@/components/catalog/pass-cover-art'
import { PASS_COVER_RATIO_CLASS } from '@/components/catalog/pass-cover-ratios'
import { ProviderProfileLink } from '@/components/provider/provider-profile-link'
import { Card } from '@/components/ui/card'
import { ShareButton } from '@/components/ui/share-button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { usePublicPass } from '@/hooks/use-catalog'
import { useInView } from '@/hooks/use-in-view'
import { useSession } from '@/hooks/use-session'
import { usePurchaseFlow, type PurchaseFlow } from '@/hooks/use-purchase-flow'
import { mayStartPayment, mustWarnAgainstSecondPayment } from '@/types/payment'
import { useCanUseWallet } from '@/hooks/use-wallet'
import { formatNim, formatSessions } from '@/lib/format'
import { providerPath } from '@/lib/provider-url'
import { viewerOwnsListing } from '@/lib/pass-ownership'
import { useHeldPass } from '@/hooks/use-passes'
import { PASS_ACCENTS, resolveAccent } from '@/lib/pass-accent'
import { serviceKind } from '@/lib/service-kind'
import { resolveCoverUrl } from '@/api/media'
import type { PassListing } from '@/types/domain'

/**
 * The conversion screen (docs/03-DESIGN-SYSTEM.md §42-§45).
 *
 * Desktop is two columns with the purchase panel sticky beside the content.
 * Mobile stacks, and once the panel scrolls away a sticky action bar keeps the
 * price and CTA reachable — a structural adaptation, not a squeezed desktop
 * layout (§7, §114).
 *
 * Within seconds the reader should have what §43 asks for: what it is, who
 * provides it, how many sessions, how much, and what they receive. Those five
 * answers are the first five things on the page.
 *
 * Everything here is readable without a wallet; only the CTA needs one.
 */
export function PublicPassPage() {
  const { id } = useParams<{ id: string }>()
  const query = usePublicPass(id)

  if (query.isPending) return <PassDetailSkeleton />

  if (query.isError) {
    return (
      <Page>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Page>
    )
  }

  return <PassDetail item={query.data} />
}

function PassDetail({ item }: { item: PassListing }) {
  const canUseWallet = useCanUseWallet()
  const { session } = useSession()
  const flow = usePurchaseFlow(item.id)
  const { ref: panelRef, inView: panelInView } = useInView<HTMLDivElement>()
  usePurchaseRecovery(flow)

  const kind = serviceKind(item.service.name)
  const accent = PASS_ACCENTS[resolveAccent(item.accent, item.service.name, kind.id)]

  const walletReady = canUseWallet
  const unavailable = item.status !== 'ACTIVE'
  // The provider's own listing. There is no purchase to start, so the sticky
  // bar has no price/CTA pair to carry and would just pin a dead control to
  // the bottom of the screen.
  const ownListing = viewerOwnsListing(item, session?.identity.wallet)
  // Already on their shelf. Same reasoning as `ownListing`: there is no
  // purchase to start, so the bar has no price/CTA pair to carry.
  const alreadyOwned = Boolean(useHeldPass(item.id))

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
  /*
   * `flow.busy` is deliberately not in here any more.
   *
   * It used to be, so the bar could show a spinning "Working…". Every busy
   * state that carries a purchase is now a state where a checkout surface —
   * the QR modal or the mobile confirmation sheet — is open over this page and
   * is the thing reporting, and `PurchaseButton` renders nothing there. Keeping
   * the bar would pin an empty strip with a price on it to the bottom of the
   * screen, under a modal.
   *
   * `CREATING_INTENT` stays, because it is the one busy state with no purchase
   * and therefore no surface: the button is the only acknowledgement the tap
   * gets, and it names what it is waiting on.
   */
  const showStickyBar =
    !ownListing &&
    !alreadyOwned &&
    !panelInView &&
    (mayStartPayment(flow.state) || flow.state.kind === 'CREATING_INTENT')

  useScrollToPaymentOutcome(panelRef, flow, panelInView)

  return (
    <>
      <Page className="pb-28 lg:pb-16">
        <div className="flex items-center justify-between gap-4">
          <Link
            to={providerPath(item.provider)}
            className="inline-flex min-h-11 sm:min-h-0 items-center gap-1.5 text-small text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {item.provider.name}
          </Link>
          <ShareButton copiedMessage="Pass link copied" />
        </div>

        <div className="mt-6 grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16">
          <div className="min-w-0">
            <PassCoverArt
              seed={item.provider.name}
              tone={{ from: accent.from, to: accent.to }}
              coverSrc={resolveCoverUrl(item.coverUrl)}
              className="flex items-end justify-between rounded-2xl p-6"
            >
              {/* Silent when the service is only the pass's own name again. */}
              <span className="eyebrow text-white/75">
                {item.service.name.trim().toLowerCase() === item.title.trim().toLowerCase()
                  ? ''
                  : item.service.name}
              </span>
              <span
                aria-hidden="true"
                className="numeric font-display text-[3.5rem] font-semibold leading-none text-white/35 sm:text-[4.5rem]"
              >
                {item.sessions}
              </span>
            </PassCoverArt>

            <h1 className="mt-8 text-h1 text-ink">{item.title}</h1>

            <ProviderProfileLink provider={item.provider} className="mt-5" />

            {/*
              On a phone the purchase panel is at the bottom of the page, so
              the two facts the customer is actually shopping on would not
              appear until they had scrolled past everything. §114 puts them
              directly under the provider on mobile; on desktop the panel
              beside the content already says it.
            */}
            <p className="mt-7 flex items-baseline gap-3 border-y border-line py-4 lg:hidden">
              <span className="numeric font-display text-h2 font-semibold text-ink">
                {formatNim(item.priceLuna)}
              </span>
              <span className="text-body text-ink-muted">for {formatSessions(item.sessions)}</span>
            </p>

            {item.description ? (
              <div className="mt-8 max-w-reading">
                <h2 className="sr-only">About this pass</h2>
                <p className="whitespace-pre-line text-pretty text-body-lg leading-relaxed text-ink-muted">
                  {item.description}
                </p>
              </div>
            ) : null}

            <section className="mt-12">
              <PassFacts
                sessions={item.sessions}
                priceLuna={item.priceLuna}
                serviceName={item.service.name}
                passTitle={item.title}
                expirationAt={item.expirationAt}
                accent={item.accent}
              />
            </section>
          </div>

          <aside ref={panelRef} className="lg:sticky lg:top-24 lg:self-start">
            <PurchasePanel item={item} flow={flow} />
          </aside>
        </div>
      </Page>

      {/* Mobile action bar — appears only once the panel is off screen. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur-md transition-transform duration-[--nimpass-duration-base] ease-[--nimpass-ease] lg:hidden ${
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
            <p className="truncate text-small text-ink-muted">{formatSessions(item.sessions)}</p>
            <p className="numeric font-display text-body-lg font-semibold text-ink">
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
  const { session } = useSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlPurchaseId = searchParams.get('purchase')
  const { purchaseId, resume } = flow

  // Resume whatever the URL points at, once per id. `resume` reports IDLE for
  // an id the backend does not recognise, so a stale link is harmless.
  const resumed = useRef<string | null>(null)
  useEffect(() => {
    if (!session) { resumed.current = null; return }
    if (!urlPurchaseId || resumed.current === urlPurchaseId) return
    resumed.current = urlPurchaseId
    void resume(urlPurchaseId)
  }, [urlPurchaseId, resume, session])

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

function PassDetailSkeleton() {
  return (
    <Page>
      <Skeleton className="h-4 w-40" />
      <div className="mt-6 grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16">
        <div className="space-y-6">
          <Skeleton className={`${PASS_COVER_RATIO_CLASS} w-full rounded-2xl`} />
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="h-9 w-52" />
          <div className="space-y-3 pt-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <Card className="space-y-4 p-6">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-10 w-40" />
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
