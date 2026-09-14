import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

/** Focused actions only (docs/03-DESIGN-SYSTEM.md §83). */
export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-raised',
          /*
           * Never taller than the viewport, and scrollable when the content
           * wants more room.
           *
           * The redemption sheet is what forces this: a QR code, a countdown, a
           * readable reference and two buttons do not fit a phone in landscape,
           * and a centred dialog that overflows puts its actions off both edges
           * at once with no way to reach them. `dvh` rather than `vh` so the
           * mobile browser's collapsing address bar does not leave the bottom
           * of the sheet under the chrome.
           */
          'max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain',
          className,
        )}
        // Keeps the sheet clear of the notch and home indicator inside the
        // Nimiq Pay WebView.
        style={{
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <DialogPrimitive.Title className="text-h3 font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-body text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink sm:size-9"
            aria-label="Close"
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
