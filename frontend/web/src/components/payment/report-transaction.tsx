import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PurchaseFlow } from '@/hooks/use-purchase-flow'

/**
 * "I already paid" — the way out of a purchase the backend was never told
 * about.
 *
 * ## Why this exists at all
 *
 * The mini-app checkout reports its own hash: `sendBasicTransactionWithData()`
 * returns one and the flow submits it immediately. The QR checkout cannot. It
 * is paid inside Nimiq Pay, on a phone, while the intent lives in a browser on
 * a different device — so the backend has to *find* the payment by sweeping
 * the provider's payout address, which needs an address-indexing history node
 * and an exact match on the sender. When the node is missing, rate-limited, or
 * the customer approved from a second account in their wallet, the payment is
 * on chain and the purchase waits forever with nothing to wait for.
 *
 * That is the "paid but still pending" failure, and this control is its cure:
 * the one person who can always see the transaction is the person who made it.
 *
 * ## Why it is safe
 *
 * A hash is a nomination, not a proof. What arrives here re-enters the exact
 * verification path a wallet-reported hash takes — sender, recipient, exact
 * value, network, execution result, inclusion, macro-block finality, and the
 * `verified_payments` primary key that lets one transaction settle one
 * purchase ever. Pasting a stranger's hash buys nothing and settles nothing
 * (docs/09-SECURITY.md §96).
 *
 * ## Why it is folded away
 *
 * Almost nobody needs it, and a transaction-hash field on a checkout screen is
 * exactly the crypto-console aesthetic the design system rules out
 * (docs/03-DESIGN-SYSTEM.md §20). It sits behind one plain sentence, in the
 * states where waiting is otherwise the only option.
 */
/**
 * How long the automatic path gets before this is offered at all.
 *
 * Long enough to cover scanning the code, unlocking a phone, approving in
 * Nimiq Pay, one block, and the sweep that finds it — with room to spare. A
 * customer who is simply taking their time must never be shown a
 * troubleshooting form that implies something has gone wrong.
 */
const TROUBLESHOOTING_DELAY_MS = 90_000

export function ReportTransaction({ flow }: { flow: PurchaseFlow }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [offered, setOffered] = useState(false)
  const available = flow.mayReportTransaction

  useEffect(() => {
    if (!available) {
      setOffered(false)
      return
    }
    const timer = setTimeout(() => setOffered(true), TROUBLESHOOTING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [available])

  if (!available || !offered) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-small text-ink-subtle underline underline-offset-4 hover:text-ink"
      >
        Paid, but still waiting? Enter the transaction yourself
      </button>
    )
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-line bg-surface-muted p-4"
      onSubmit={(event) => {
        event.preventDefault()
        void flow.reportTransaction(value)
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="report-tx" className="text-small font-medium text-ink">
          Transaction hash
        </label>
        <p className="text-small text-ink-subtle">
          You should not normally need this — a payment is found on its own. If yours has not
          appeared, open it in Nimiq Pay and copy its transaction hash. We check it against the
          blockchain, and it only works for a payment that matches this purchase.
        </p>
      </div>
      <Input
        id="report-tx"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="64 characters"
        autoComplete="off"
        spellCheck={false}
        className="numeric"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={flow.reporting} disabled={flow.reporting || !value.trim()}>
          Check this transaction
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={flow.reporting}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      <p className="text-micro text-ink-subtle">
        Do not send another payment. If a transaction exists, this finds it.
      </p>
    </form>
  )
}
