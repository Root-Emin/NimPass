import { formatNim } from '@/lib/format'
import type { PaymentRequest, Purchase } from '@/types/domain'

/**
 * The server's payment terms, rendered verbatim.
 *
 * Shared by both checkouts so the phone and the desktop show the same four
 * facts in the same words. Every value comes from `Purchase.paymentRequest` —
 * the backend's snapshot of recipient, exact Luna amount, `NP1:` reference,
 * network and expiry. Nothing on this side derives, rounds or recomputes any of
 * it: the catalog's displayed price is not what gets paid, the intent's is
 * (docs/08-ARCHITECTURE.md §71).
 *
 * `Pay from` is the wallet the intent was issued for. It is shown because the
 * backend requires the transaction's sender to equal it, and on the desktop
 * flow the transaction is initiated on a different physical device — so a
 * customer holding two wallets needs to be told which one before they scan,
 * not after they have paid from the wrong one (docs/05 §43, §131).
 */
export function PaymentTerms({
  purchase,
  request,
}: {
  purchase: Purchase
  request: PaymentRequest
}) {
  return (
    <>
      <p className="text-body-lg font-medium text-ink">
        {formatNim(request.valueLuna)} · {request.network}
      </p>
      <dl className="space-y-2 break-all text-small text-ink-muted">
        <div>
          <dt>Pay from</dt>
          <dd className="text-ink">{purchase.customerWallet}</dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd>{request.recipient}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{request.data}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{new Date(request.expiresAt).toLocaleString()}</dd>
        </div>
      </dl>
    </>
  )
}
