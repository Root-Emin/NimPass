import { cn } from '@/lib/utils'

/**
 * Simple discovery filters (docs/03-DESIGN-SYSTEM.md §40) — pills, not a
 * filter sidebar.
 *
 * Rendered as a radio group so assistive tech announces the options as one
 * control with one selection, rather than as a row of unrelated buttons.
 *
 * Every pill stays tabbable rather than implementing roving tabindex. The full
 * ARIA radiogroup pattern expects arrow-key navigation, which this does not
 * have; with only a handful of pills, tabbing through them is predictable and
 * nothing is unreachable. Worth revisiting if the filter set grows.
 */
export interface FilterOption {
  value: string
  label: string
}

export function FilterPills({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: FilterOption[]
  value: string
  onChange: (value: string) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0', className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 py-1.5 text-small transition-colors duration-[--nimpass-duration-fast] sm:min-h-9',
              selected
                ? 'border-ink bg-ink text-ink-inverse'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
