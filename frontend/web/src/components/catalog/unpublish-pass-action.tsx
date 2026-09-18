import { EyeOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { messageForApiError } from '@/api/errors'
import { Button, type ButtonProps } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast-context'
import { useUnpublishPass } from '@/hooks/use-provider-workspace'
import type { Pass } from '@/types/domain'

/**
 * Take a Pass off the shelf, with the pause that belongs in front of it.
 *
 * The sibling of `DeletePassAction`, built the same way and for the same
 * reason: one component for both places a provider can reach the action — the
 * card in My Store and the Pass they have open — so the wording, the
 * confirmation and what happens afterwards cannot drift between them.
 *
 * ## What it is, said as the difference from delete
 *
 * The backend sets `status = 'UNAVAILABLE'`. The Pass leaves Discover, the
 * provider's public storefront and the provider directory's count, loses its
 * public page and refuses new purchases — and keeps its id, its data, its place
 * in My Store and every record that points at it. `Publish` accepts UNAVAILABLE
 * as a source state, so it goes back on sale as the same Pass
 * (docs/08-ARCHITECTURE.md §34, §136).
 *
 * That is the whole point of it existing next to Delete, and it is why this is
 * deliberately *not* styled as a destructive action: a `primary` confirm
 * button, no red, no warning tone. Borrowing delete's colour would teach a
 * provider that the two are the same size of decision, and the entire reason
 * this action was added is that they are not.
 *
 * ## What the dialog says
 *
 * The two consequences separately, because they land on two different groups of
 * people: nobody new can see or buy it, and everybody who already bought it is
 * untouched. The second is the sentence a provider actually hesitates over, and
 * it is a promise the backend keeps — a purchased pass is a separate record
 * with its own frozen snapshot, and nothing in the purchase, payment, session
 * or redemption trail reads this status.
 *
 * Reversibility is stated too, because it is the fact that makes this the safe
 * choice and the reason someone should be here rather than in the delete
 * dialog.
 *
 * ## Failure
 *
 * Reported inside the dialog, next to the button that caused it, with the
 * dialog left open — a toast disappears, and this is a decision the provider
 * still has to make.
 */
export function UnpublishPassAction({
  pass,
  variant = 'secondary',
  size = 'sm',
  label = 'Remove from listing',
  className,
  icon,
  onUnpublished,
}: {
  pass: Pick<Pass, 'id' | 'title' | 'status'>
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  label?: string
  className?: string
  /** Replaces the default icon, for callers with their own row layout. */
  icon?: ReactNode
  /** Fires after a successful withdrawal, e.g. to close a menu around this. */
  onUnpublished?: () => void
}) {
  const [open, setOpen] = useState(false)
  const unpublish = useUnpublishPass()
  const toast = useToast()

  // Only something that is actually on sale can be taken off it. A draft was
  // never listed and an archived Pass is finished; the backend answers 409 for
  // both, so the control is absent rather than present and doomed.
  if (pass.status !== 'ACTIVE') return null

  const confirm = () => {
    unpublish.mutate(pass.id, {
      onSuccess: () => {
        setOpen(false)
        onUnpublished?.()
        toast.show('Removed from listing', 'success')
      },
    })
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => {
          unpublish.reset()
          setOpen(true)
        }}
      >
        {icon ?? <EyeOff aria-hidden="true" />}
        {label}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (unpublish.isPending) return
          setOpen(next)
        }}
        title="Remove this pass from listing?"
        description={
          <span className="space-y-2">
            <span className="block">
              This pass will no longer be visible to new customers or available for purchase.
            </span>
            <span className="block">
              Existing purchases will not be affected. You can publish it again at any time.
            </span>
            {unpublish.isError ? (
              <span className="block text-danger" role="alert">
                {messageForApiError(unpublish.error)}
              </span>
            ) : null}
          </span>
        }
        confirmLabel="Remove from listing"
        tone="primary"
        loading={unpublish.isPending}
        onConfirm={confirm}
      />
    </>
  )
}
