import { Link } from 'react-router-dom'

import { PaymentStateView } from '@/components/payment/payment-state-view'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatNim } from '@/lib/format'
import type { Purchase } from '@/types/domain'
import { paymentStateFromPurchase } from '@/types/payment'

/**
 * Purchases that did not become a pass — shown above the pass list.
 *
 * The compensation case is why this exists. A customer whose payment was
 * verified and whose pass expired before activation has paid for something
 * and owns nothing; if My Passes showed only passes, their evidence would
 * simply be missing from the app, and the obvious conclusion — "my payment
 * vanished, let me try again" — is the one outcome every rule in this milestone
 * is written to prevent (§28, §29).
 *
 * So the purchase is shown as a purchase. It is never dressed up as a pass,
 * given a session count, or counted in the pass grid: there is no entitlement
 * here, and inventing a placeholder one would be a lie with a balance on it.
 *
 * The state copy comes from the same `PaymentStateView` the purchase flow uses,
 * so a compensation case reads identically whether the customer is still on the
 * pass page or opening the app three days later.
 */
export function PurchaseAttentionList({ purchases }: { purchases: Purchase[] }) {
  if (purchases.length === 0) return null

  return (
    <section className="mb-12">
      <h2 className="text-h3 text-ink">Payments we're still resolving</h2>
      <p className="mt-1.5 text-body text-ink-muted">
        These payments have no pass yet. There is nothing more to pay.
      </p>

      <ul className="mt-5 space-y-4">
        {purchases.map((purchase) => (
          <li key={purchase.purchaseIntentId}>
            <Card variant="plain" className="rounded-2xl p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-medium text-ink">{purchase.passTitle}</p>
                <p className="font-display text-body-lg font-semibold text-ink">
                  {formatNim(purchase.priceLuna)}
                </p>
              </div>

              <PaymentStateView className="mt-4" state={paymentStateFromPurchase(purchase)} />

              <div className="mt-4">
                <Button asChild size="sm" variant="ghost">
                  {/* Back to the purchase, with recovery intact: the pass
                      page reads this id from the URL and re-reads the
                      authoritative state rather than trusting anything here. */}
                  <Link to={`/pass/${purchase.passId}?purchase=${purchase.purchaseIntentId}`}>
                    Open this purchase
                  </Link>
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}
