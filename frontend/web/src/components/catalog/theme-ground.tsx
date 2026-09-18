import type { ReactNode } from 'react'

import { PASS_ACCENTS, type PassAccent } from '@/lib/pass-accent'
import { cn } from '@/lib/utils'

/**
 * The soft ground the pass creation screen is composed on.
 *
 * The reference this screen borrows its shape from (Luma) sets the thing being
 * made on a wide, quiet gradient rather than on chrome, and that part is worth
 * taking. What is not taken is the palette: the wash is mixed from the pass
 * tone the provider has chosen, so the page is never the same colour twice and
 * never the one saturated purple of the reference. Every stop comes from
 * `lib/pass-accent` — the six earth tokens the contract actually accepts —
 * which is what keeps the ground calm on a warm canvas instead of growing a
 * palette of its own.
 *
 * It is the element's own background rather than a layer floated over the
 * page: a background paints beneath its descendants by definition, so the
 * form above it needs no z-index and nothing can end up underneath an opaque
 * wash.
 */
export function ThemeGround({
  accent,
  className,
  children,
}: {
  accent: PassAccent
  className?: string
  children: ReactNode
}) {
  const tone = PASS_ACCENTS[accent]

  return (
    <div
      className={cn(
        // Edge to edge on a phone, an inset surface once there is room for one.
        '-mx-5 px-5 py-6 sm:-mx-6 sm:rounded-[2rem] sm:px-7 sm:py-10 lg:mx-0 lg:px-10',
        'transition-colors duration-[--nimpass-duration-slow] ease-[--nimpass-ease]',
        className,
      )}
      style={{
        backgroundImage: [
          `radial-gradient(86% 64% at 0% 0%, ${tone.well} 0%, transparent 62%)`,
          `radial-gradient(64% 52% at 100% 2%, ${tone.wash} 0%, transparent 58%)`,
          `radial-gradient(72% 58% at 88% 100%, color-mix(in oklab, ${tone.from} 8%, transparent) 0%, transparent 64%)`,
          `linear-gradient(162deg, ${tone.well} 0%, ${tone.wash} 34%, var(--color-canvas) 78%)`,
        ].join(', '),
      }}
    >
      {children}
    </div>
  )
}
