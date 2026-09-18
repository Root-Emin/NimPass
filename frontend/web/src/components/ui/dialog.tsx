import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import { dialogPanelClass } from '@/components/ui/dialog-panel'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

/**
 * One backdrop for every popup in the product: the page dims and goes out of
 * focus so the panel on top is unmistakably the only thing to answer.
 *
 * Shared rather than repeated, because a dialog that blurs differently from a
 * menu reads as two different products. `bg-ink/40` carries the dimming on its
 * own where `backdrop-filter` is unsupported.
 */
export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-40 bg-ink/40 backdrop-blur-[10px]',
        'data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Centres a panel in the viewport.
 *
 * Layout rather than `top-1/2 … -translate-y-1/2`, so a transform on the panel
 * — the entry animation, say — can never knock it off centre, and a tall panel
 * shrinks against the viewport instead of hanging off both edges.
 *
 * `pointer-events-none` matters: the positioner covers the whole screen, so
 * without it every click outside the panel would land here instead of on the
 * overlay and dismissing by clicking away would stop working. The panel itself
 * takes its pointer events back.
 *
 * The padding is the safe area (docs/04-NIMIQ-MINI-APPS.md §54) — inside the
 * Nimiq Pay WebView it keeps the panel clear of the notch and home indicator —
 * and `dvh` so the mobile browser's collapsing address bar cannot hide the
 * bottom of a full-height panel.
 */
export function DialogPositioner({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-center justify-center"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
    >
      {children}
    </div>
  )
}

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
      <DialogOverlay />
      <DialogPositioner>
        <DialogPrimitive.Content
          className={cn(dialogPanelClass, 'max-w-md sm:p-7', className)}
          {...props}
        >
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            {/* `min-w-0`: the close button beside this is a fixed 44px touch
                target, and without this the heading refuses to wrap and pushes
                the panel wider than the screen. */}
            <div className="min-w-0 space-y-1.5">
              <DialogPrimitive.Title className="text-pretty text-h3 font-semibold text-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-pretty text-body text-ink-muted">
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
      </DialogPositioner>
    </DialogPrimitive.Portal>
  )
}
