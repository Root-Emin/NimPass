import { cn } from '@/lib/utils'

export interface ProgressProps {
  value: number
  max: number
  className?: string
  label?: string
}

/**
 * Session progress. The numbers come straight from the backend; this never
 * computes a remaining balance of its own (docs/08-ARCHITECTURE.md §37).
 */
export function Progress({ value, max, className, label }: ProgressProps) {
  const safeMax = max > 0 ? max : 1
  const percent = Math.min(100, Math.max(0, (value / safeMax) * 100))
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-inset', className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-[--nimpass-duration-slow] ease-[--nimpass-ease]"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
