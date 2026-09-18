import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Page } from '@/components/layout/page'
import { PurchaseCheckout } from '@/components/payment/purchase-checkout'
import { PaymentStateView } from '@/components/payment/payment-state-view'
import { PaymentSuccessModal } from '@/components/payment/payment-success-modal'
import { useCheckoutRoute } from '@/hooks/use-checkout-device'
import { usePurchaseSuccess } from '@/hooks/use-purchase-success'
import { ReportTransaction } from '@/components/payment/report-transaction'
import { usePurchaseFlow } from '@/hooks/use-purchase-flow'

/** Authentication is enforced by the route and again by every backend call. */
export function PurchasePage() {
  const { id } = useParams<{ id: string }>()
  const flow = usePurchaseFlow(undefined, id)
  const { resume } = flow
  const route = useCheckoutRoute()
  const success = usePurchaseSuccess(flow.state, { enabled: route !== 'qr' })
  useEffect(() => { if (id) void resume(id) }, [id, resume])
  return <Page>
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-h1">Your purchase</h1>
      {flow.error ? <p role="alert" className="text-danger">{flow.error}</p> : null}
      {/* Resuming a purchase that settled while the tab was away lands on
          COMPLETE, and this is the first time that customer sees it — so the
          confirmation belongs here too, subject to the same once-only rule. */}
      <PaymentSuccessModal state={flow.state} success={success} />
      <PurchaseCheckout flow={flow} />
      <PaymentStateView state={flow.state} onReconcile={() => void flow.reconcile()} reconciling={flow.reconciling}
        onRetry={() => void flow.start()} />
      <ReportTransaction flow={flow} />
    </div>
  </Page>
}
