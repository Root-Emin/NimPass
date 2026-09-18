import { Check, Info, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ToastContext, type Toast, type ToastTone } from '@/components/ui/toast-context'
import { cn } from '@/lib/utils'

/**
 * Brief confirmations that do not interrupt.
 *
 * The small class of feedback Nimpass was missing: an action succeeded, it
 * changed nothing on screen, and the person needs to know it happened. Copying
 * a link is the canonical case — the page looks identical afterwards, so
 * without a word the button reads as broken.
 *
 * Deliberately narrow, because the product already has better places for
 * everything else:
 *
 *   - **Not for errors that need a decision.** `Alert` and `ErrorState` stay,
 *     inline, next to the thing that failed, where they can be read at leisure
 *     and carry a retry. A toast that disappears is the wrong home for
 *     anything about money (docs/05 §62: an uncertain payment must stay on
 *     screen).
 *   - **Not for state.** Nothing here is authoritative; a toast is a report of
 *     something that already happened server-side or in the browser.
 *
 * Accessibility: one polite live region that exists from first paint, so a
 * screen reader announces the message when it arrives rather than announcing
 * the region appearing. `status` for confirmations, `alert` for warnings —
 * a warning is worth interrupting for, a "link copied" is not.
 */

/** How long a message stays before it fades. Long enough to read a sentence. */
const TOAST_MS = 3200

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = nextId.current++
      // Replace rather than stack. Two of these on screen at once has never
      // been the right answer for confirmations this small, and a queue would
      // be a feature nothing asks for.
      setToasts([{ id, message, tone }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      )
      return id
    },
    [dismiss],
  )

  // Timers outlive a fast unmount otherwise — a navigation away from the page
  // that raised the toast.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} />
    </ToastContext.Provider>
  )
}

const TONE: Record<ToastTone, { icon: ReactNode; className: string }> = {
  success: {
    icon: <Check className="size-4 text-success" aria-hidden="true" />,
    className: 'border-success/25',
  },
  info: {
    icon: <Info className="size-4 text-info" aria-hidden="true" />,
    className: 'border-line',
  },
  warning: {
    icon: <TriangleAlert className="size-4 text-warning" aria-hidden="true" />,
    className: 'border-warning/30',
  },
}

function ToastViewport({ toasts }: { toasts: Toast[] }) {
  const warning = toasts.some((toast) => toast.tone === 'warning')

  return (
    <div
      // Bottom-centre on a phone, where a thumb is nowhere near it, and tucked
      // into the bottom-right from `sm` so it never covers page content on a
      // wide screen. Above the sticky purchase bar, below a dialog.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 sm:inset-x-auto sm:right-6 sm:justify-end"
      style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
    >
      <div role={warning ? 'alert' : 'status'} aria-live={warning ? 'assertive' : 'polite'}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-full border bg-surface px-4 py-2.5 text-small text-ink shadow-raised',
              'animate-fade-in',
              TONE[toast.tone].className,
            )}
          >
            {TONE[toast.tone].icon}
            <span className="min-w-0 flex-1 truncate">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
