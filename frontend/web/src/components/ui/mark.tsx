import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { initialsOf } from '@/lib/format'
import { markTone, type MarkTone } from '@/lib/mark-tone'

/**
 * Derived visual identity for objects the contract gives no image.
 *
 * `PublicProvider` is `{ id, name }` and a pass carries no artwork, so there
 * is no photograph to show and inventing one would be fabricating provider
 * data (docs/08-ARCHITECTURE.md §11). What this does instead is give each
 * object a *stable colour*: providers hash from their name, passes use
 * the colour the provider picked so a guitar pass and a training pass
 * are not both pine by default.
 *
 * That is decoration, and it is labelled as such — it never sits where a
 * photograph would imply "this is what the provider looks like", and every
 * mark also carries the initials or name in text. It exists because a wall of
 * identical grey cards is harder to scan than a wall of distinguishable ones
 * (docs/03-DESIGN-SYSTEM.md §29-§30).
 *
 * The palette itself lives in `lib/mark-tone`.
 */
const SIZES = {
  sm: 'size-8 text-micro rounded-md',
  md: 'size-11 text-small rounded-lg',
  lg: 'size-14 text-body rounded-xl',
  xl: 'size-20 text-h3 rounded-2xl',
  '2xl': 'size-24 text-h2 rounded-3xl sm:size-28',
} as const

export function Mark({
  seed,
  name,
  size = 'md',
  round = false,
  className,
}: {
  /** What the colour is derived from — usually the provider or service name. */
  seed: string
  /** The name the initials come from. Defaults to the seed. */
  name?: string
  size?: keyof typeof SIZES
  round?: boolean
  className?: string
}) {
  const tone = markTone(seed)

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-display font-semibold tracking-tight text-white/95',
        SIZES[size],
        round && 'rounded-full',
        className,
      )}
      style={{ backgroundImage: `linear-gradient(140deg, ${tone.from}, ${tone.to})` }}
    >
      {initialsOf(name ?? seed)}
    </span>
  )
}

/**
 * The wide version — a card or page banner rather than a chip.
 *
 * Carries whatever the caller puts on it (a session count, a provider mark) on
 * top of the same derived colour field, with a soft highlight so it reads as a
 * surface rather than a flat swatch.
 */
export function MarkField({
  seed,
  tone,
  className,
  children,
}: {
  seed: string
  /** When set, this is a chosen pass colour rather than a hash of `seed`. */
  tone?: MarkTone
  className?: string
  children?: ReactNode
}) {
  const resolved = tone ?? markTone(seed)

  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{ backgroundImage: `linear-gradient(135deg, ${resolved.from}, ${resolved.to})` }}
    >
      {/* Off-centre highlight: enough to give the field depth, not enough to
          read as a gradient effect in its own right (§28, §107). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 78% 8%, rgb(255 255 255 / 0.22), transparent 62%)',
        }}
      />
      {children}
    </div>
  )
}
