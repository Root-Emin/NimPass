import { AlertTriangle, Loader2, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

import { ApiError, messageForApiError } from '@/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The three surfaces every data-backed view needs: loading, empty and error
 * (docs/03-DESIGN-SYSTEM.md §80-§81).
 *
 * These exist so that a view with no backend behind it degrades honestly.
 * Showing "we couldn't load this" is correct; inventing content is not
 * (docs/08-ARCHITECTURE.md §11).
 *
 * All three are quiet: a tonal panel, a short line of type, and at most one
 * action. No illustration packs, no full-page apologies (§80, §107).
 */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="flex min-h-40 flex-col items-center justify-center gap-3 text-ink-subtle"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <p className="text-small">{label}</p>
    </div>
  )
}

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface-muted px-6 py-16 text-center',
        className,
      )}
    >
      <p className="font-display text-h3 font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-sm text-body text-ink-muted">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

export interface ErrorStateProps {
  error: unknown
  onRetry?: () => void
  title?: string
  className?: string
}

/**
 * Distinguishes "we could not reach Nimpass" from "the backend said no".
 * A retry is only offered for the former, where retrying can actually help.
 */
export function ErrorState({ error, onRetry, title, className }: ErrorStateProps) {
  const isNetwork = error instanceof ApiError && error.isNetworkError
  const heading = title ?? (isNetwork ? "Can't reach Nimpass" : 'Something went wrong')

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface px-6 py-16 text-center',
        className,
      )}
      role="alert"
    >
      <span
        className={cn(
          'flex size-11 items-center justify-center rounded-full',
          isNetwork ? 'bg-surface-inset text-ink-subtle' : 'bg-danger-soft text-danger',
        )}
        aria-hidden="true"
      >
        {isNetwork ? <WifiOff className="size-5" /> : <AlertTriangle className="size-5" />}
      </span>
      <p className="font-display text-h3 font-semibold text-ink">{heading}</p>
      <p className="max-w-sm text-body text-ink-muted">{messageForApiError(error)}</p>
      {onRetry && isNetwork ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      ) : null}
    </div>
  )
}
