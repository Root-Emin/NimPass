import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Confirmation for a consequential action — deactivating a package, for
 * instance (docs/03-DESIGN-SYSTEM.md §83).
 *
 * Uses `role="alertdialog"` so assistive tech announces it as a decision that
 * needs a response rather than as ordinary content.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  loading = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
  loading?: boolean
  onConfirm: () => void
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          role="alertdialog"
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-raised',
          )}
        >
          <div className="space-y-1.5">
            <DialogPrimitive.Title className="text-h3 font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-body text-ink-muted">
              {description}
            </DialogPrimitive.Description>
          </div>

          <div className="flex justify-end gap-3">
            <DialogPrimitive.Close asChild>
              <Button variant="secondary" size="sm" disabled={loading}>
                {cancelLabel}
              </Button>
            </DialogPrimitive.Close>
            <Button
              size="sm"
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
