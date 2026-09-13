import { AlertCircle } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Form field scaffolding (docs/03-DESIGN-SYSTEM.md §71).
 *
 * A label is always rendered — a placeholder is never the only label — and the
 * hint and error are wired to the control through `aria-describedby` so screen
 * readers announce them with the input.
 */
export interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  className?: string
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
  }) => ReactNode
}

export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={id} className="flex items-baseline gap-2 text-small font-medium text-ink">
        {label}
        {optional ? <span className="text-micro font-normal text-ink-subtle">Optional</span> : null}
      </label>

      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}

      {error ? (
        <p id={errorId} className="flex items-center gap-1.5 text-small text-danger">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-small text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
