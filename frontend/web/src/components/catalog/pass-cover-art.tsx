import type { ReactNode } from 'react'

import { PASS_COVER_RATIO_CLASS } from '@/components/catalog/pass-cover-ratios'
import { MarkField } from '@/components/ui/mark'
import { cn } from '@/lib/utils'
import type { MarkTone } from '@/lib/mark-tone'

/**
 * The artwork a pass wears, everywhere a pass is shown: Discover, the public
 * pass page, My Passes, My Store, the Profile preview and the creation
 * preview.
 *
 * A photograph, when the provider uploaded one. The accent field otherwise.
 * The overlay copy (glyph, count, service name) sits on a dark wash so it
 * stays readable on a light photo; the wash is skipped on the colour field,
 * which is already dark.
 *
 * One frame, in one place. The cover is always the same 16×10 box, sized by
 * the card's width:
 *
 *  - a phone and a desktop show the same picture, not two crops;
 *  - `object-cover` fills that frame without stretching, so a portrait, a
 *    landscape and a square upload all land undistorted on the same centre;
 *  - the row cannot shift as the image decodes, because the box has its height
 *    before the bytes arrive.
 *
 * Hover zoom, where a card offers it, scales the photograph inside the frame
 * rather than the frame itself — otherwise the crop would shift on hover.
 */
export function PassCoverArt({
  seed,
  tone,
  coverSrc,
  className,
  children,
}: {
  seed: string
  tone: MarkTone
  coverSrc: string | null
  className?: string
  children?: ReactNode
}) {
  const frame = cn('relative w-full overflow-hidden', PASS_COVER_RATIO_CLASS, className)

  if (!coverSrc) {
    return (
      <MarkField seed={seed} tone={tone} className={frame}>
        {children}
      </MarkField>
    )
  }

  return (
    <div className={cn('isolate', frame)}>
      <img
        src={coverSrc}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(
          'absolute inset-0 -z-10 h-full w-full max-w-none object-cover object-center',
          'transition-transform duration-[--nimpass-duration-slow] ease-[--nimpass-ease]',
          'motion-reduce:transition-none group-hover:scale-[1.03] motion-reduce:group-hover:scale-100',
        )}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-black/55 via-black/20 to-black/10"
      />
      {children}
    </div>
  )
}
