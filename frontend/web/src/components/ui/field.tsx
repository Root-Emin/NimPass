import { AlertCircle } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Form field scaffolding (docs/03-DESIGN-SYSTEM.md §71).
 *
 * A label is always rendered — a placeholder is never the only label — and the
 * hint and error are wired to the control through `aria-describedby` so screen
 * readers announce them with the input.
 *
 * Two layouts:
 *
 *   `stacked` — label above control. The default, and the right shape whenever
 *               the answer is long or the field needs room.
 *   `row`     — label left, control right, inside a `FieldGroup`. For short,
 *               settled answers (a service, a count, a price) where a column of
 *               labelled boxes reads heavier than the thing it is describing
 *               (§70, §111). It stays a row on a phone: those answers are
 *               compact enough to sit on one line, and stacking them makes
 *               every option look like a new form.
 */
export interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  layout?: 'stacked' | 'row'
  /** Leading glyph, row layout only. Decorative — the label carries the meaning. */
  icon?: ReactNode
  className?: string
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
  }) => ReactNode
}

export function Field({
  label,
  hint,
  error,
  optional,
  layout = 'stacked',
  icon,
  className,
  children,
}: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  const controlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  }

  const message = error ? (
    <p id={errorId} className="flex items-center gap-1.5 text-small text-danger">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
      {error}
    </p>
  ) : hint ? (
    <p id={hintId} className="text-small text-ink-subtle">
      {hint}
    </p>
  ) : null

  if (layout === 'row') {
    return (
      <div className={cn('px-2 py-2 sm:px-3', className)}>
        <div className="flex items-center gap-3 sm:gap-4">
          <label
            htmlFor={id}
            className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1 text-body text-ink"
          >
            {icon ? (
              <span className="text-ink-subtle [&>svg]:size-4 [&>svg]:shrink-0" aria-hidden="true">
                {icon}
              </span>
            ) : null}
            <span className="truncate font-medium">{label}</span>
            {optional ? (
              <span className="shrink-0 text-micro font-normal text-ink-subtle">Optional</span>
            ) : null}
          </label>

          <div className="w-auto shrink-0">{children(controlProps)}</div>
        </div>

        {message ? <div className="px-1 pb-1 pt-1.5 sm:pl-8">{message}</div> : null}
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={id} className="flex items-baseline gap-2 text-small font-medium text-ink">
        {label}
        {optional ? <span className="text-micro font-normal text-ink-subtle">Optional</span> : null}
      </label>

      {children(controlProps)}

      {message}
    </div>
  )
}

/**
 * A run of related row fields under one optional caption.
 *
 * One surface with hairlines between the rows, rather than a card per field:
 * the group is the object, and the fields are its properties (§26, §35).
 */
export function FieldGroup({
  label,
  className,
  children,
}: {
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={className}>
      {label ? <h2 className="eyebrow mb-2.5 px-1 text-ink-subtle">{label}</h2> : null}
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {children}
      </div>
    </section>
  )
}
