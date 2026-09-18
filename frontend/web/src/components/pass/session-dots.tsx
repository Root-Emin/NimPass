import { cn } from '@/lib/utils'

/**
 * The punch-card row: one dot per session, filled for the ones already used
 * (docs/03-DESIGN-SYSTEM.md §52, docs/01-PRODUCT.md §34).
 *
 * Purely decorative. The counts are always written out in text beside it, so
 * this never carries information on its own — colour and shape are not
 * allowed to be the only status indicator (§87, docs/02-USER-FLOWS.md §105).
 *
 * Above a couple of dozen sessions the dots stop being scannable and start
 * being a texture, so the same information falls back to a bar. The threshold
 * is where a row stops reading as countable, not a pass-size rule.
 */
const DOT_LIMIT = 24

const TONES = {
  light: { used: 'bg-accent', free: 'bg-surface-inset', track: 'bg-surface-inset' },
  pass: { used: 'bg-pass-ink', free: 'bg-pass-line', track: 'bg-pass-line' },
  inverse: { used: 'bg-white', free: 'bg-white/35', track: 'bg-white/35' },
} as const

export function SessionDots({
  used,
  total,
  tone = 'light',
  className,
}: {
  used: number
  total: number
  tone?: keyof typeof TONES
  className?: string
}) {
  const palette = TONES[tone]
  const safeTotal = Math.max(0, Math.trunc(total))
  const safeUsed = Math.min(Math.max(0, Math.trunc(used)), safeTotal)

  if (safeTotal === 0) return null

  if (safeTotal > DOT_LIMIT) {
    const percent = (safeUsed / safeTotal) * 100
    return (
      <div
        aria-hidden="true"
        className={cn('h-1.5 w-full overflow-hidden rounded-full', palette.track, className)}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-[--nimpass-duration-slow] ease-[--nimpass-ease]',
            palette.used,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    )
  }

  return (
    <div aria-hidden="true" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {Array.from({ length: safeTotal }, (_, index) => (
        <span
          key={index}
          className={cn(
            'size-2 rounded-full transition-colors duration-[--nimpass-duration-slow]',
            index < safeUsed ? palette.used : palette.free,
          )}
        />
      ))}
    </div>
  )
}
