import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from './confirm-dialog'
import { Dialog, DialogContent } from './dialog'
import { Sheet, SheetContent } from './sheet'

/**
 * Every popup in Nimpass interrupts the same way: centred in the viewport over
 * a page that is dimmed and blurred. One surface, no exceptions — a menu that
 * drops from the top next to a dialog that sits in the middle reads as two
 * different products, so the rule is asserted rather than left to each caller.
 *
 * Factories rather than elements, because these are `describe.each` cases and
 * not a rendered list.
 */
const POPUPS: Array<[name: string, open: () => ReactElement]> = [
  [
    'dialog',
    () => (
      <Dialog open>
        <DialogContent title="Title" description="Description" />
      </Dialog>
    ),
  ],
  [
    'sheet',
    () => (
      <Sheet open>
        <SheetContent title="Menu" />
      </Sheet>
    ),
  ],
  [
    'confirmation',
    () => (
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
      />
    ),
  ],
]

describe.each(POPUPS)('%s', (_name, openPopup) => {
  it('is centred over a dimmed, blurred page', () => {
    const { baseElement } = render(openPopup())

    // A confirmation announces itself as an alertdialog, the rest as dialogs.
    const panel = baseElement.querySelector('[role="dialog"],[role="alertdialog"]')
    expect(panel).not.toBeNull()
    const positioner = panel?.parentElement

    // Centring is layout, so no transform — the entry animation's — can knock
    // the panel off centre.
    expect(positioner).toHaveClass('flex', 'items-center', 'justify-center')

    // The positioner covers the screen, so it has to let clicks through to the
    // overlay beneath or dismissing by clicking away stops working.
    expect(positioner).toHaveClass('pointer-events-none')

    const overlay = baseElement.querySelector('.backdrop-blur-\\[10px\\]')
    expect(overlay).not.toBeNull()
    expect(overlay).toHaveClass('fixed', 'inset-0', 'bg-ink/40')
  })
})
