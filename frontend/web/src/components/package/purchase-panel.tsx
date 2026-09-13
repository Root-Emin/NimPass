import { Check, History, ShieldCheck, Ticket, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PaymentStateView } from '@/components/payment/payment-state-view'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { PurchaseFlow } from '@/hooks/use-purchase-flow'
import { useWallet } from '@/hooks/use-wallet'
import { formatExpiry, formatNim, formatSessions, perSessionLuna } from '@/lib/format'
import { miniAppOpenerUrl } from '@/lib/nimiq'
import { mayRetryPayment, mayStartPayment } from '@/types/payment'
import type { PackageListing } from '@/types/domain'

/**
 * The purchase surface (docs/03-DESIGN-SYSTEM.md §45): a calm panel, clear
 * price, one obvious CTA, and none of the crypto-checkout aesthetic §20 rules
 * out.
 *
 * The flow is owned by the page so the sticky mobile bar drives the same
 * attempt rather than starting a second one.
 */
export function PurchasePanel({ item, flow }: { item: PackageListing; flow: PurchaseFlow }) {
  const wallet = useWallet()
  const walletReady = wallet.capabilities.walletOperationsAvailable
  const unavailable = item.status !== 'ACTIVE'

  return (
    <Card className="p-5 sm:p-6">
      <div className="space-y-1">
        <p className="font-display text-h2 font-semibold text-ink">
          {formatSessions(item.sessions)}
        </p>
        <p className="font-display text-h1 font-semibold tracking-[-0.02em] text-ink">
          {formatNim(item.priceLuna)}
        </p>
        <p className="text-small text-ink-muted">
          {formatNim(perSessionLuna(item.priceLuna, item.sessions) ?? 0)} per session
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <PurchaseButton item={item} flow={flow} walletReady={walletReady} unavailable={unavailable} />

        <PaymentStateView
          state={flow.state}
          onRetry={mayRetryPayment(flow.state) ? () => void flow.start() : undefined}
        />

        {flow.state.kind === 'COMPLETE' ? null : (
          <p className="text-center text-micro text-ink-subtle">
            Payment goes directly to{' '}
            <Link to={`/providers/${item.provider.id}`} className="underline underline-offset-2">
              {item.provider.name}
            </Link>
            .
          </p>
        )}
      </div>

      <Separator className="my-6" />

      <h2 className="text-small font-medium text-ink">What you'll get</h2>
      <ul className="mt-3 space-y-2.5 text-body text-ink-muted">
        <li className="flex gap-2.5">
          <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          {formatSessions(item.sessions)} with {item.provider.name}
        </li>
        <li className="flex gap-2.5">
          <Ticket className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          A digital pass that counts your sessions down
        </li>
        <li className="flex gap-2.5">
          <History className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          A record of every session you use
        </li>
        <li className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          {formatExpiry(item.expirationAt)}
        </li>
      </ul>
    </Card>
  )
}

/**
 * The wallet-required boundary. Public browsing never asks for a wallet; this
 * is the first point that needs one (docs/08-ARCHITECTURE.md §15).
 */
export function PurchaseButton({
  item,
  flow,
  walletReady,
  unavailable,
  size = 'lg',
  block = true,
}: {
  item: PackageListing
  flow: PurchaseFlow
  walletReady: boolean
  unavailable: boolean
  size?: 'md' | 'lg'
  block?: boolean
}) {
  if (unavailable) {
    return (
      <Button block={block} size={size} disabled>
        Not available
      </Button>
    )
  }

  if (!walletReady) {
    // No wallet in this runtime: name the next step instead of pretending the
    // purchase can happen here (docs/08-ARCHITECTURE.md §87, §14).
    //
    // Where the handoff can actually work, the next step is a link rather than
    // an instruction: the customer continues in Nimiq Pay on *this* package
    // instead of being sent to find it again (docs/04-NIMIQ-MINI-APPS.md
    // §41-§42, docs/05 §83). No purchase intent is created here — price and
    // recipient are issued inside the wallet-capable flow (docs/05 §84).
    const opener = miniAppOpenerUrl()

    return (
      <div className="space-y-2">
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
            ? `Nimpass opens in Nimiq Pay on this package, where you can pay ${formatNim(item.priceLuna)}.`
            : 'Open Nimpass in Nimiq Pay to buy this package.'}
        </p>
      </div>
    )
  }

  // Disabled is the default: the button only re-arms from a state where a
  // second payment is definitely safe. Anything past the wallet call — including
  // UNCERTAIN, where nothing is in flight but a transaction may exist — keeps it
  // locked, so the control can never contradict the "do not send another
  // payment" message rendered beside it (docs/05 §55, §62).
  const canStart = mayStartPayment(flow.state)

  return (
    <Button
      block={block}
      size={size}
      loading={flow.busy}
      disabled={!canStart}
      onClick={() => void flow.start()}
    >
      {flow.busy ? 'Working…' : `Buy with NIM · ${formatNim(item.priceLuna)}`}
    </Button>
  )
}
