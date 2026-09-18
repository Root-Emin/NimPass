import { useState } from 'react'

import { Identicon } from '@/components/wallet/identicon'
import { cn } from '@/lib/utils'

/** How many identicons of one wallet the backend accepts (`ProviderInput`). */
export const AVATAR_VARIANTS = 256

/** One screenful of options, and what "Show more" adds — or "Show less" removes — each time. */
const PAGE = 24

function floorFor(value: number) {
  return Math.min(AVATAR_VARIANTS, Math.max(PAGE, value + 1))
}

/**
 * Pick the face this provider shows, from Nimiq's own identicon set.
 *
 * Nimiq has no gallery of ready-made avatars to copy from: an identicon is
 * *generated* from a string, out of an asset set of 21 faces, 21 hats, 21
 * sides, 21 bottoms and 10 colour pairs. So the options here are real Nimiq
 * identicons, each derived from this wallet's own address — the first one is
 * the address's own identicon, the face Nimpass gives every provider by default
 * (docs/DECISIONS.md ADR-010), and the rest are further faces of the same
 * account rather than a face borrowed from somebody else's wallet.
 *
 * Only the number is stored. The picture is drawn by the same library on every
 * screen that shows this provider, so the choice is identical for a visitor who
 * is logged out, for another customer, and for the provider themselves.
 */
export function AvatarPicker({
  wallet,
  value,
  onChange,
  labelledBy,
  className,
}: {
  wallet: string
  value: number
  onChange: (next: number) => void
  labelledBy: string
  className?: string
}) {
  // Enough rows to include the current choice, so an option that is already
  // selected is never off-screen behind "Show more".
  const floor = floorFor(value)
  const [shown, setShown] = useState(floor)
  const visible = Math.max(shown, floor)
  const canShowMore = visible < AVATAR_VARIANTS
  const canShowLess = visible > floor

  return (
    <div className={cn('space-y-3', className)}>
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        className="grid grid-cols-4 justify-items-center gap-2 p-0.5 min-[380px]:grid-cols-5 sm:grid-cols-6 sm:gap-3 md:grid-cols-8"
      >
        {Array.from({ length: visible }, (_, variant) => {
          const selected = variant === value
          return (
            <button
              key={variant}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={variant === 0 ? 'Your wallet identicon' : `Identicon ${variant + 1}`}
              onClick={() => onChange(variant)}
              className={cn(
                'flex size-11 items-center justify-center rounded-full transition-[transform,box-shadow] duration-[--nimpass-duration-base]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                selected
                  ? 'scale-105 ring-2 ring-ink ring-offset-2 ring-offset-surface'
                  : 'opacity-80 hover:scale-105 hover:opacity-100',
              )}
            >
              <Identicon address={wallet} variant={variant} size={40} className="size-10" />
            </button>
          )
        })}
      </div>

      {canShowMore || canShowLess ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {canShowMore ? (
            <button
              type="button"
              onClick={() => setShown(Math.min(AVATAR_VARIANTS, visible + PAGE))}
              className="inline-flex min-h-11 items-center text-small text-ink-muted underline underline-offset-4 transition-colors duration-[--nimpass-duration-fast] hover:text-ink sm:min-h-0"
            >
              Show more
            </button>
          ) : null}
          {canShowLess ? (
            <button
              type="button"
              onClick={() => setShown(Math.max(floor, visible - PAGE))}
              className="inline-flex min-h-11 items-center text-small text-ink-muted underline underline-offset-4 transition-colors duration-[--nimpass-duration-fast] hover:text-ink sm:min-h-0"
            >
              Show less
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
