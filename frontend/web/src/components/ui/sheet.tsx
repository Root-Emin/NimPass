import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import { DialogOverlay, DialogPositioner } from '@/components/ui/dialog'
import { dialogPanelClass } from '@/components/ui/dialog-panel'
import { cn } from '@/lib/utils'

/**
 * Mobile navigation surface (docs/03-DESIGN-SYSTEM.md §34, §84).
 * Built on Radix Dialog so focus trapping and escape handling come for free.
 *
 * It is centred over a blurred page like every other popup rather than sliding
 * down from the top: one placement for everything that interrupts, so the menu
 * and a payment confirmation do not feel like they belong to different apps.
 */
export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

export function SheetContent({
  className,
  children,
  title,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPositioner>
        <DialogPrimitive.Content
          className={cn(dialogPanelClass, 'max-w-sm gap-6', className)}
          {...props}
        >
          <div className="flex items-center justify-between">
            <DialogPrimitive.Title className="text-h3 font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="-mr-2 flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink sm:size-10"
              aria-label="Close menu"
            >
              <X className="size-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPositioner>
    </DialogPrimitive.Portal>
  )
}
