import { Wallet } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { networkHint } from '@/components/payment/network-hint'
import { PaymentTerms } from '@/components/payment/payment-terms'
import type { PurchaseFlow } from '@/hooks/use-purchase-flow'
import { currentTransport } from '@/lib/nimiq'
import { purchaseHandoff } from '@/lib/nimiq/purchase-handoff'
import { normaliseAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PaymentRequest, Purchase } from '@/types/domain'

/**
 * The two mobile checkouts, side by side because they are one branch.
 *
 * Both answer "how does this phone pay the intent that already exists?" — with
 * the injected Nimiq provider if there is one, by handing the purchase to the
 * Nimiq Pay app if there is not. Neither creates an intent, decides a price or
 * chooses a recipient; those are settled server-side before either renders.
 *
 * `embedded` is presentation only, and it does two things. Both are shown
 * inline on `/purchases/{id}`, where they supply their own heading and frame;
 * inside the mobile confirmation sheet the sheet already supplies both, and a
 * second border around the same content reads as two panels.
 *
 * It also folds the payment terms away. The sheet states the pass, the provider
 * and the price above them, and the terms themselves — a 36-character address,
 * a payment reference, an expiry — are verification detail rather than the
 * decision being made. Left expanded they pushed the Confirm button off the
 * bottom of a phone screen, which is the exact failure the sheet exists to
 * remove. The same disclosure the desktop QR modal uses, for the same reason.
 */

/** The terms, folded away where a surface has already stated the essentials. */
function FoldedTerms({ purchase, request }: { purchase: Purchase; request: PaymentRequest }) {
  return (
    <details className="group text-left text-small">
      <summary className="min-h-11 cursor-pointer list-none rounded-md py-2 text-ink-muted marker:content-[''] hover:text-ink">
        Payment details
        <span
          className="ml-1 inline-block transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          &rsaquo;
        </span>
      </summary>
      <div className="mt-3">
        <PaymentTerms purchase={purchase} request={request} />
      </div>
    </details>
  )
}

/**
 * The mobile checkout: review the server's terms, then approve in Nimiq Pay.
 *
 * This is the branch that ends in `sendBasicTransactionWithData()` — the
 * official Nimiq provider call, reached through `WalletTransport.pay()` with
 * the backend's own `recipient`, `valueLuna` and `NP1:` reference passed
 * through untouched (https://nimiq.dev/mini-apps/api-reference/nimiq-provider).
 * Nothing here computes a price, an address or a reference.
 *
 * One gate stands before the wallet call, and it is not security — the
 * backend re-checks and would refuse the payment regardless. It exists
 * because the backend's refusal arrives *after* the money has moved, and a
 * wrong-**network** transfer cannot be undone: `getNetwork()` returns the
 * provider namespace, not the selected NIM chain, and the API exposes no
 * chain switch, so the only honest thing available is to state it and ask
 * (ADR-005).
 *
 * ## The gate that used to be here, and why it went
 *
 * There was a second one: check that the account selected in Nimiq Pay is the
 * wallet this intent was issued to. It was there because the verifier refused
 * any payment whose sender was not that wallet — so paying from a second
 * account meant real NIM moved and no Pass could ever be issued, and a
 * warning beforehand was the only protection available.
 *
 * That rule is gone for a payment carrying this intent's own reference, which
 * is every payment this screen makes: `sendBasicTransactionWithData` puts the
 * `NP1:` bytes on chain, and the backend correlates on those rather than on
 * an address Nimiq Pay picks for itself (ADR-013). Which account pays no
 * longer changes the outcome, so requiring the customer to prove it before
 * they may press Approve is friction protecting nothing — and it is friction
 * on exactly the path a customer arrives at after scanning a QR with their
 * phone.
 *
 * The selected wallet is still *shown*, because which account is about to be
 * debited is worth knowing. It is information now, not a checkpoint.
 *
 * The approve button is a single user gesture straight into `flow.pay()`,
 * which owns the dispatch lock, the broadcast bookkeeping and the submission.
 */
export function NativeCheckout({
  flow,
  purchase,
  embedded = false,
}: {
  flow: PurchaseFlow
  purchase: Purchase
  /** Rendered inside a surface that already has a heading and a frame. */
  embedded?: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [networkChecked, setNetworkChecked] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = purchase.paymentRequest
  if (!request) return null

  /**
   * Reads which account Nimiq Pay currently has selected, purely to show it.
   *
   * A mismatch is no longer an error and no longer blocks anything: the Pass
   * goes to the signed-in wallet whichever account pays.
   */
  async function showSelectedWallet() {
    setChecking(true)
    setError(null)
    try {
      const address = await currentTransport()?.requestAccount()
      setSelected(address ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read your selected wallet.')
    } finally {
      setChecking(false)
    }
  }

  const payingFromAnother =
    selected !== null &&
    normaliseAddress(selected) !== normaliseAddress(purchase.customerWallet)

  return (
    <section
      className={cn('space-y-4', !embedded && 'rounded-xl border border-line p-4')}
      aria-label="Review payment"
    >
      {embedded ? null : <h2 className="text-h3">Review your payment</h2>}
      {embedded ? (
        <FoldedTerms purchase={purchase} request={request} />
      ) : (
        <PaymentTerms purchase={purchase} request={request} />
      )}

      <p className="text-small">
        The Pass will belong to the wallet you are signed in with, whichever account you approve
        the payment with.
      </p>
      <Button
        variant="secondary"
        loading={checking}
        disabled={checking}
        onClick={() => void showSelectedWallet()}
      >
        {selected ? 'Check again' : 'Show selected wallet'}
      </Button>
      {selected ? (
        <p className="text-small text-ink-muted">
          Paying from <span className="numeric">{selected}</span>
          {payingFromAnother ? ' — a different account from the one you signed in with. That is fine; the Pass still goes to your signed-in wallet.' : '.'}
        </p>
      ) : null}

      <label className="flex min-h-11 items-start gap-3 text-small">
        <input
          type="checkbox"
          checked={networkChecked}
          onChange={(event) => setNetworkChecked(event.target.checked)}
        />
        <span>
          I have selected {request.network} in Nimiq Pay.
        </span>
      </label>
      <p className="text-micro text-ink-subtle">
        Nimiq Pay controls the selected network. Its Mini App API does not expose a network
        switch or check. {networkHint(request.network)}
      </p>

      {/*
        One user gesture straight into `flow.pay()`, which owns the dispatch
        lock, the broadcast bookkeeping and the submission. `loading` is on it
        because the two backend calls in front of the wallet — the network
        check and the dispatch lock — take long enough on a phone that a button
        which merely greys out reads as a dead press.
      */}
      <Button
        block
        size="lg"
        loading={flow.busy}
        disabled={!networkChecked || checking || flow.busy}
        onClick={() => {
          setNetworkChecked(false)
          void flow.pay()
        }}
      >
        Confirm and pay in Nimiq Pay
      </Button>

      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/**
 * The mobile browser branch: this phone, one tap away from paying.
 *
 * No QR — the device that would scan it is the device displaying it. The custom
 * scheme is the documented tap link (https://nimiq.dev/mini-apps), and it hands
 * the purchase route straight to an installed Nimiq Pay, which then resolves
 * the authoritative terms from the backend exactly as the desktop flow's phone
 * does. The link carries a purchase id and nothing else.
 */
export function MobileHandoff({
  purchase,
  embedded = false,
}: {
  purchase: Purchase
  /** Rendered inside a surface that already has a heading and a frame. */
  embedded?: boolean
}) {
  const request = purchase.paymentRequest
  let handoff: ReturnType<typeof purchaseHandoff> | null = null
  try {
    handoff = purchaseHandoff(purchase.purchaseIntentId)
  } catch {
    handoff = null
  }
  if (!request || !handoff) return null

  return (
    <section
      className={cn('space-y-4', !embedded && 'rounded-xl border border-line p-4')}
      aria-label="Continue in Nimiq Pay"
    >
      {embedded ? null : <h2 className="text-h3">Pay in Nimiq Pay</h2>}
      {embedded ? (
        <FoldedTerms purchase={purchase} request={request} />
      ) : (
        <PaymentTerms purchase={purchase} request={request} />
      )}
      <Button asChild block size="lg">
        <a href={handoff.opener}>
          <Wallet aria-hidden="true" />
          Open in Nimiq Pay
        </a>
      </Button>
      <p className="text-small text-ink-muted">
        Nimiq Pay opens this purchase. Sign in with the wallet shown above and approve the payment
        there — this page updates on its own once it lands.
      </p>
      <details className="text-small">
        <summary>Nimiq Pay didn’t open?</summary>
        <p className="mt-2 text-ink-muted">
          Install Nimiq Pay, or open it and paste this address into Mini Apps → Custom URL.
        </p>
        <code className="mt-2 block break-all text-micro">{handoff.page}</code>
      </details>
    </section>
  )
}
