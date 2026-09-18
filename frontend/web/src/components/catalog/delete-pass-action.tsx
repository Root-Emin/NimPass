import { Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, type ButtonProps } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast-context'
import { useDeletePass } from '@/hooks/use-provider-workspace'
import { messageForApiError } from '@/api/errors'
import type { Pass } from '@/types/domain'

/**
 * Delete a Pass, with the pause that belongs in front of it.
 *
 * One component for both places a provider can reach the action — the card in
 * My Store and the Pass they have open — so the wording, the confirmation and
 * what happens afterwards cannot drift between them.
 *
 * ## What the dialog says, and why it says exactly that
 *
 * The backend archives rather than deletes, because purchases, payments and
 * customers' own passes reference this row (docs/08-ARCHITECTURE.md §135-§136).
 * That is not a technicality to hide: a provider deciding whether to press this
 * needs to know that the ten people who already bought it keep what they paid
 * for. So the dialog states the two consequences separately — new purchases
 * stop, existing passes continue — rather than one ambiguous "are you sure?".
 *
 * It is still framed as permanent, because it is: an archived Pass cannot be
 * edited or republished, and creating it again makes a different Pass. Nothing
 * here promises an undo that does not exist.
 *
 * That permanence is now the *distinguishing* fact rather than an incidental
 * one, because a provider reaching this has just been offered "Remove from
 * listing" one row above it. The dialog therefore names the alternative
 * explicitly: someone who only wants to stop selling for a while should be told
 * here, at the last moment, that they are in the wrong dialog.
 *
 * ## Failure
 *
 * A refusal is reported in the dialog, next to the button that caused it, and
 * the dialog stays open. A toast would be the wrong home — it disappears, and
 * this is an action the provider still has to decide about.
 */
export function DeletePassAction({
  pass,
  /** Where to go once it is gone. Absent means stay where we are. */
  redirectTo,
  variant = 'ghost',
  size = 'sm',
  label = 'Delete',
  className,
  icon,
  onDeleted,
}: {
  pass: Pick<Pass, 'id' | 'title' | 'status'>
  redirectTo?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  label?: string
  className?: string
  /** Replaces the default trash icon, for callers with their own row layout. */
  icon?: ReactNode
  /** Fires after a successful delete, e.g. to close a menu around this. */
  onDeleted?: () => void
}) {
  const [open, setOpen] = useState(false)
  const remove = useDeletePass()
  const navigate = useNavigate()
  const toast = useToast()

  // Already archived: there is nothing left to delete, and the backend answers
  // 409. The control simply is not there.
  if (pass.status === 'ARCHIVED') return null

  const confirm = () => {
    remove.mutate(pass.id, {
      onSuccess: () => {
        setOpen(false)
        onDeleted?.()
        toast.show('Pass deleted', 'success')
        if (redirectTo) void navigate(redirectTo)
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
          remove.reset()
          setOpen(true)
        }}
      >
        {icon ?? <Trash2 aria-hidden="true" />}
        {label}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (remove.isPending) return
          setOpen(next)
        }}
        title="Delete this Pass?"
        description={
          <span className="space-y-2">
            <span className="block">
              “{pass.title}” will no longer be available for new purchases, and it will disappear
              from your store and from Discover.
            </span>
            <span className="block">
              Passes people have already bought are unaffected — their sessions and history stay
              exactly as they are.
            </span>
            <span className="block">
              This cannot be undone. To stop selling it for a while and put it back later, use
              “Remove from listing” instead.
            </span>
            {remove.isError ? (
              <span className="block text-danger" role="alert">
                {messageForApiError(remove.error)}
              </span>
            ) : null}
          </span>
        }
        confirmLabel="Delete Pass"
        tone="danger"
        loading={remove.isPending}
        onConfirm={confirm}
      />
    </>
  )
}
