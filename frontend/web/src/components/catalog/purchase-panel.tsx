import { Check, History, PenLine, ShieldCheck, Ticket, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useSession } from '@/hooks/use-session'
import { useHeldPass } from '@/hooks/use-passes'
import { SignInDialog } from '@/components/wallet/sign-in-dialog'
import { PurchaseCheckout } from '@/components/payment/purchase-checkout'
import { useMobileCheckoutSheet } from '@/components/payment/mobile-checkout-visibility'
import { Link } from 'react-router-dom'

import { checkoutStatus } from '@/components/payment/checkout-status'
import { PaymentStateView } from '@/components/payment/payment-state-view'
import { PaymentSuccessModal } from '@/components/payment/payment-success-modal'
import { usePurchaseSuccess } from '@/hooks/use-purchase-success'
import { ReportTransaction } from '@/components/payment/report-transaction'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { PurchaseFlow } from '@/hooks/use-purchase-flow'
import { useCheckoutRoute } from '@/hooks/use-checkout-device'
import { useCanUseWallet } from '@/hooks/use-wallet'
import { formatExpiry, formatNim, formatSessions, perSessionLuna } from '@/lib/format'
import { providerPath } from '@/lib/provider-url'
import { viewerOwnsListing } from '@/lib/pass-ownership'
import { miniAppOpenerUrl } from '@/lib/nimiq'
import { mayRetryPayment, mayStartPayment } from '@/types/payment'
import type { PassListing } from '@/types/domain'

/**
 * The purchase surface (docs/03-DESIGN-SYSTEM.md §45): a calm panel, clear
 * price, one obvious CTA, and none of the crypto-checkout aesthetic §20 rules
 * out.
 *
 * Sessions read first and the price sits under them as the figure: the product
 * is the sessions, and the amount is what they cost (§36, §123).
 *
 * The flow is owned by the page so the sticky mobile bar drives the same
 * attempt rather than starting a second one.
 */
export function PurchasePanel({ item, flow }: { item: PassListing; flow: PurchaseFlow }) {
  const walletReady = useCanUseWallet()
  const unavailable = item.status !== 'ACTIVE'
  // Opens only on COMPLETE — the backend's verified, finalised, pass-issued
  // state — and only the first time this purchase reaches it.
  //
  // Off on the desktop QR route, where the checkout modal the customer has
  // been watching announces success itself. Two stacked dialogs would put its
  // "View Pass" link behind an inert layer.
  const route = useCheckoutRoute()
  const success = usePurchaseSuccess(flow.state, { enabled: route !== 'qr' })
  /*
   * The mobile confirmation sheet, owned here rather than inside the checkout.
   *
   * While it is open it covers this panel, so the two things the panel would
   * otherwise also render — the flow's error line and the "paid, but still
   * waiting" recovery offer — are rendered *in the sheet* instead. Knowing
   * which of the two is showing is what keeps exactly one of each in the
   * document, and keeps the one that is there reachable.
   */
  const sheet = useMobileCheckoutSheet(flow)
  const covered = route !== 'qr' && sheet.open

  return (
    <Card className="rounded-2xl p-6 sm:p-7">
      <div className="space-y-1.5">
        <p className="text-body-lg font-medium text-ink">{formatSessions(item.sessions)}</p>
        <p className="numeric font-display text-h1 font-semibold text-ink">
          {formatNim(item.priceLuna)}
        </p>
        <p className="text-small text-ink-muted">
          {formatNim(perSessionLuna(item.priceLuna, item.sessions) ?? 0)} per session
        </p>
      </div>

      <div className="mt-7 space-y-3">
        <PurchaseButton
          item={item}
          flow={flow}
          walletReady={walletReady}
          unavailable={unavailable}
        />

        {flow.error && !covered ? <p role="alert">{flow.error}</p> : null}
        <PaymentSuccessModal state={flow.state} success={success} />
        <PurchaseCheckout flow={flow} listing={item} sheet={sheet} />
        {/*
          Also yielded while the sheet covers this panel. The sheet carries the
          status line and the one action that belongs to a payment in flight;
          two "Check again" buttons for one purchase — one of them unreachable
          under a modal — is the shape of the bug this guard prevents.

          Every state that needs the paragraph this renders — uncertain,
          refused, compensation — closes the sheet, so those are never hidden.
        */}
        {covered ? null : (
          <PaymentStateView
            state={flow.state}
            onCancel={flow.mayCancel ? () => void flow.cancel() : undefined}
            cancelling={flow.cancelling}
            onRetry={mayRetryPayment(flow.state) ? () => void flow.start() : undefined}
            onReconcile={() => void flow.reconcile()}
            reconciling={flow.reconciling}
          />
        )}

        {/*
          The escape hatch for a payment the backend was never told about.

          Yielded to the mobile confirmation sheet while that is open over this
          page — the same control, rendered where the customer can actually
          reach it. Every other state the sheet has closed for (uncertain, an
          expired intent) is handled here, so exactly one instance is on screen
          at a time.
        */}
        {covered ? null : (
          <div className="flex justify-center">
            <ReportTransaction flow={flow} />
          </div>
        )}

        {flow.state.kind === 'COMPLETE' ? null : (
          <p className="text-center text-micro text-ink-subtle">
            Payment goes directly to{' '}
            <Link to={providerPath(item.provider)} className="underline underline-offset-2">
              {item.provider.name}
            </Link>
            .
          </p>
        )}
      </div>

      <div className="mt-7 border-t border-line pt-6">
        <h2 className="text-small font-medium text-ink">What you'll get</h2>
        <ul className="mt-4 space-y-3 text-body text-ink-muted">
          <li className="flex gap-3">
            <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            {formatSessions(item.sessions)} with {item.provider.name}
          </li>
          <li className="flex gap-3">
            <Ticket className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            A digital pass that counts your sessions down
          </li>
          <li className="flex gap-3">
            <History className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            A record of every session you use
          </li>
          {/* Only when there is a real deadline to state. */}
          {item.expirationAt ? (
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              {formatExpiry(item.expirationAt)}
            </li>
          ) : null}
        </ul>
      </div>
    </Card>
  )
}

/**
 * The wallet-required boundary. Public browsing never asks for a wallet; this
 * is the first point that needs one (docs/08-ARCHITECTURE.md §15).
 *
 * Which wallet is not this component's business. Inside Nimiq Pay the purchase
 * runs through the injected provider; in an ordinary browser it runs through
 * the Nimiq Hub. Both arrive here as `walletReady`, and the button is the same
 * button — a desktop customer is never told to use a phone in order to pay.
 */
export function PurchaseButton({
  item,
  flow,
  walletReady,
  unavailable,
  size = 'lg',
  block = true,
}: {
  item: PassListing
  flow: PurchaseFlow
  walletReady: boolean
  unavailable: boolean
  size?: 'md' | 'lg'
  block?: boolean
}) {
  const { session } = useSession()
  const held = useHeldPass(item.id)
  const [signInOpen, setSignInOpen] = useState(false)
  /*
   * The provider looking at their own listing.
   *
   * Checked before every other branch because it is the most specific thing
   * true about this screen: an unpublished pass, a missing wallet or an absent
   * session all describe the visitor, while this describes the pass. Showing
   * "Log in to buy" to the person who created it would be actively misleading.
   *
   * Presentation only. `POST /purchases` refuses the same account with 403
   * SELF_PURCHASE_NOT_ALLOWED whatever this renders, and the flow has a state
   * for that answer (docs/09-SECURITY.md §11, §37).
   */
  if (viewerOwnsListing(item, session?.identity.wallet)) {
    return <OwnListingState item={item} block={block} size={size} />
  }
  /*
   * They are already holding one of these, with sessions left on it.
   *
   * Second only to the provider's own listing, and for the same reason: it is
   * a fact about this screen that makes the Buy button unusable, so offering
   * one and then refusing it (409 PASS_ALREADY_OWNED) would be a worse way of
   * saying the same thing. The control that replaces it opens the pass they
   * have, which is what they actually want from here.
   */
  if (held) {
    return <AlreadyOwnedState passID={held.id} remaining={held.remainingSessions} block={block} size={size} />
  }
  if (unavailable) {
    return (
      <Button block={block} size={size} disabled>
        Not available
      </Button>
    )
  }
  if (!walletReady) {
    const opener = miniAppOpenerUrl()

    return (
      <div className="space-y-2.5">
        {opener ? (
          <Button asChild block={block} size={size}>
            <a href={opener} rel="noreferrer">
              <Wallet aria-hidden="true" />
              Open in Nimiq Pay
            </a>
          </Button>
        ) : (
          <Button block={block} size={size} disabled>
            Buy with NIM · {formatNim(item.priceLuna)}
          </Button>
        )}
        <p className="text-center text-small text-ink-subtle">
          {opener
            ? `Nimpass opens in Nimiq Pay on this pass, where you can pay ${formatNim(item.priceLuna)}.`
            : "We couldn't reach a Nimiq wallet from this page."}
        </p>
      </div>
    )
  }
  if (!session) return <>
    <Button block={block} size={size} onClick={() => setSignInOpen(true)}>Log in to buy</Button>
    <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
  </>
  /*
   * Once a checkout surface is on screen, it is the one reporting.
   *
   * `INTENT_CREATED` is the QR modal or the mobile confirmation sheet; every
   * settling state after it is the same surface following the payment. A Buy
   * button behind them, spinning and repeating their status line word for word,
   * is one message rendered twice — and on a phone the second copy is the one
   * pinned to the bottom of the screen where a thumb rests.
   *
   * `CREATING_INTENT` is deliberately not included: it has no purchase yet, so
   * no surface has anything to show, and this is the only acknowledgement the
   * press gets.
   */
  if (flow.state.kind === 'INTENT_CREATED') return null
  if (flow.busy && 'purchase' in flow.state && flow.state.purchase) return null

  // Disabled is the default: the button only re-arms from a state where a
  // second payment is definitely safe. Anything past the wallet call — including
  // UNCERTAIN, where nothing is in flight but a transaction may exist — keeps it
  // locked, so the control can never contradict the "do not send another
  // payment" message rendered beside it (docs/05 §55, §62).
  const canStart = mayStartPayment(flow.state)

  return (
    // `flow.start()` is called straight from the click with nothing awaited
    // before it. In an ordinary browser the wallet is the Nimiq Hub, which opens
    // a window, and browsers only permit that while the click is being handled —
    // the backend's purchase intent is fetched *inside* the request handed to
    // the wallet rather than before it
    // (https://nimiq.dev/hub/getting-started, and `usePurchaseFlow`).
    <Button
      block={block}
      size={size}
      loading={flow.busy}
      disabled={!canStart}
      onClick={() => void flow.start()}
    >
      {/*
        While something is in flight the button says which something.

        It used to say "Working…" for every busy state — which spans creating
        the intent, waiting for a native approval, a submitted transaction, chain
        verification, macro-block finality and pass issuance. Those take
        wildly different amounts of time and mean entirely different things to
        someone who has just parted with NIM, and collapsing them into one word
        is what made a settling purchase look like a stuck one.

        The label is `checkoutStatus`, the same projection of the same backend
        state the QR modal and the mobile sheet read. No stage is invented here:
        every one of them is a `Purchase.status` the server actually reports.
      */}
      {flow.busy ? checkoutStatus(flow.state).label : `Buy with NIM · ${formatNim(item.priceLuna)}`}
    </Button>
  )
}

/**
 * What a provider sees where the Buy button would be.
 *
 * A disabled "Buy with NIM" with no explanation reads as a bug. This says what
 * the pass is to them and offers the one thing they can actually do with it,
 * which is edit or share it (docs/03-DESIGN-SYSTEM.md §45 — one obvious
 * action, never a dead control).
 */
/**
 * The customer's own pass, already bought and not yet used up.
 *
 * Deliberately not a disabled Buy button with an explanation under it: what
 * they have is a usable pass, so the primary control goes to it. `Buy Again`
 * appears on that pass once it is finished (docs/01-PRODUCT.md §56).
 */
function AlreadyOwnedState({
  passID,
  remaining,
  block,
  size,
}: {
  passID: string
  remaining: number
  block: boolean
  size: 'md' | 'lg'
}) {
  return (
    <div className="space-y-2.5">
      <Button asChild block={block} size={size} variant="secondary">
        <Link to={`/passes/${passID}`}>
          <Ticket aria-hidden="true" />
          Open your pass
        </Link>
      </Button>
      <p className="text-center text-small text-ink-subtle">
        You already have this pass, with {formatSessions(remaining)} left. You can buy it again once it is
        finished.
      </p>
    </div>
  )
}

function OwnListingState({
  item,
  block,
  size,
}: {
  item: PassListing
  block: boolean
  size: 'md' | 'lg'
}) {
  return (
    <div className="space-y-2.5">
      <Button block={block} size={size} disabled>
        Your pass
      </Button>
      <div className="flex justify-center">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/provider/passes/${item.id}/edit`}>
            <PenLine aria-hidden="true" />
            Edit this pass
          </Link>
        </Button>
      </div>
      <p className="text-center text-small text-ink-subtle">
        You created this pass, so you cannot buy it. Share the link with a customer instead.
      </p>
    </div>
  )
}
