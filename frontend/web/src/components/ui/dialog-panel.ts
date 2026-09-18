import { cn } from '@/lib/utils'

/**
 * The centred panel every popup is built from — dialog, confirmation, menu.
 *
 * Lives beside `dialog.tsx` rather than in it so the module stays
 * components-only and fast refresh keeps working (as `button-variants.ts`
 * does for `button.tsx`).
 */
export const dialogPanelClass = cn(
  'pointer-events-auto flex w-full flex-col gap-5 rounded-2xl border border-line bg-surface p-6 shadow-raised',
  // Entry and exit are the one place §85 explicitly asks for motion.
  'data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in',
  // Never taller than the space the positioner leaves, and scrollable when the
  // content wants more room. A centred panel that overflows would otherwise put
  // its actions off both edges at once with no way to reach them.
  'max-h-full overflow-y-auto overscroll-contain',
)
