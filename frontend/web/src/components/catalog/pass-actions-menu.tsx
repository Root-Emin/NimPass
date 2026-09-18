import { Globe, MoreHorizontal, Pencil, Trash2, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { messageForApiError } from '@/api/errors'
import { DeletePassAction } from '@/components/catalog/delete-pass-action'
import { UnpublishPassAction } from '@/components/catalog/unpublish-pass-action'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast-context'
import { usePublishPass } from '@/hooks/use-provider-workspace'
import { PASS_STATUS } from '@/lib/pass-status'
import { cn } from '@/lib/utils'
import type { Pass } from '@/types/domain'

/**
 * Everything a provider can do to a Pass they made, behind one `•••`.
 *
 * ## Why the actions are a menu at all
 *
 * The card showed one action — Delete — because that was the only one there
 * was. With a publication switch beside it, three controls on every card would
 * make the grid read as a control panel, and would put "stop selling this" and
 * "destroy this" next to each other at thumb distance. The menu is the pause
 * that separates them.
 *
 * ## Why it is a centred sheet and not a dropdown
 *
 * `popup-surface.test.tsx` asserts that every popup in Nimpass interrupts the
 * same way: one panel, centred over a dimmed and blurred page. A menu anchored
 * under its trigger would be a second popup language — and on a phone it is
 * also the thing that ends up clipped at a viewport edge or pushed off-screen
 * by a card near the bottom of a scrolled grid. Centred, it cannot overflow: it
 * is sized from the viewport, never from the trigger's position. So one
 * component is both the mobile answer and the desktop one, and there is no
 * separate responsive path to get wrong.
 *
 * ## What the menu offers, and when
 *
 * The listing action is one switch with two faces, and the Pass's own status
 * decides which:
 *
 * ```text
 * ACTIVE       Edit · Remove from listing · Delete
 * UNAVAILABLE  Edit · Publish again       · Delete
 * DRAFT        Edit · Publish             · Delete
 * ```
 *
 * Nothing is offered that the backend would refuse. A DRAFT was never listed,
 * so it is offered publication rather than withdrawal; an ARCHIVED Pass never
 * reaches here, because archiving takes it out of My Store.
 *
 * The two consequential actions are the shared components rather than buttons
 * built here, so the confirmation a provider sees is identical whether they
 * reached it from this menu or from the Pass's own screen. Delete additionally
 * sits in its own group below a rule: it is the one irreversible thing on the
 * list and must not read as the next item after an ordinary one.
 *
 * Publishing needs no confirmation — it is the reversible direction — but it
 * can still be refused (409 for an unverified payout wallet), and that refusal
 * is reported here rather than pre-judged.
 */
export function PassActionsMenu({ pass, className }: { pass: Pass; className?: string }) {
  const [open, setOpen] = useState(false)
  const publish = usePublishPass()
  const toast = useToast()

  // An archived Pass is not in My Store and has no actions left. Guarded here
  // as well as in the list, so the component is honest on its own.
  if (pass.status === 'ARCHIVED') return null

  const status = PASS_STATUS[pass.status]

  const publishAgain = () => {
    publish.mutate(pass.id, {
      onSuccess: () => {
        setOpen(false)
        toast.show(pass.status === 'DRAFT' ? 'Pass published' : 'Back in Discover', 'success')
      },
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (publish.isPending) return
        if (next) publish.reset()
        setOpen(next)
      }}
    >
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          /* Named for the Pass: a grid has one of these per card, and "More
             options" alone would be a dozen identical labels in a screen
             reader's list of controls. */
          aria-label={`Actions for ${pass.title}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </SheetTrigger>

      <SheetContent title={pass.title} className="gap-4">
        {/* The state these actions are relative to, said once rather than
            inferred from which of them is present. */}
        <p className="-mt-3 text-small text-ink-muted">{status.label}</p>

        <div className="flex flex-col gap-1">
          <SheetClose asChild>
            <Link to={`/provider/passes/${pass.id}/edit`} className={menuItemClass}>
              <Pencil aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
              Edit Pass
            </Link>
          </SheetClose>

          {pass.status === 'ACTIVE' ? (
            <UnpublishPassAction
              pass={pass}
              variant="ghost"
              size="md"
              className={menuItemClass}
              icon={<EyeOff aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />}
              onUnpublished={() => setOpen(false)}
            />
          ) : (
            <button
              type="button"
              className={menuItemClass}
              disabled={publish.isPending}
              onClick={publishAgain}
            >
              <Globe aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
              {pass.status === 'DRAFT' ? 'Publish' : 'Publish again'}
            </button>
          )}

          <div className="mt-1 border-t border-line pt-1">
            <DeletePassAction
              pass={pass}
              label="Delete Pass"
              variant="ghost"
              size="md"
              className={cn(menuItemClass, 'text-danger hover:bg-danger-soft hover:text-danger')}
              icon={<Trash2 aria-hidden="true" className="size-4 shrink-0" />}
              onDeleted={() => setOpen(false)}
            />
          </div>
        </div>

        {publish.isError ? (
          <p className="text-small text-danger" role="alert">
            {messageForApiError(publish.error)}
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

/**
 * One row of the menu.
 *
 * `h-auto min-h-12` rather than the button scale's fixed height: these are
 * stacked full-width targets reached by thumb, and the extra room is what keeps
 * two adjacent rows from being one fat-finger apart
 * (docs/03-DESIGN-SYSTEM.md §89). Text is left-aligned and allowed to wrap, so
 * a long Pass name cannot force the panel wider than the viewport.
 */
const menuItemClass = cn(
  'flex h-auto min-h-12 w-full items-center justify-start gap-3 rounded-md px-3 py-2.5',
  'text-left text-body font-medium text-ink transition-colors hover:bg-surface-muted',
  'disabled:pointer-events-none disabled:opacity-45',
)
