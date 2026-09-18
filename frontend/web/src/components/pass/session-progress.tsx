import { useEffect, useRef, useState } from 'react'

import { SessionDots } from '@/components/pass/session-dots'
import { cn } from '@/lib/utils'
import type { PurchasedPass } from '@/types/domain'

/**
 * How much is left on a pass.
 *
 * The remaining count is the single most important number in the product
 * (docs/03-DESIGN-SYSTEM.md §51, docs/01-PRODUCT.md §46), so on an active pass
 * it is set as a figure rather than as body text, with the unit spelled out
 * underneath — "7 sessions remaining", never "Balance: 7" (§124).
 *
 * A completed pass leads with what was used instead: a giant zero is a poor
 * headline for a pass that did its job (§60).
 *
 * Every value is rendered straight from the backend. Nothing here decrements,
 * derives or predicts a count (docs/08-ARCHITECTURE.md §37, §49).
 */
const SIZES = {
  /** Pass detail — the signature screen. */
  hero: { figure: 'text-figure', label: 'text-body-lg', meta: 'text-body' },
  /** A pass in a collection. */
  card: { figure: 'text-h1 sm:text-display', label: 'text-small', meta: 'text-small' },
} as const

const TONES = {
  light: { figure: 'text-ink', label: 'text-ink-muted', meta: 'text-ink-subtle' },
  pass: { figure: 'text-pass-ink', label: 'text-pass-ink-muted', meta: 'text-pass-ink-muted' },
} as const

export function SessionBalance({
  pass,
  size = 'card',
  tone = 'light',
  className,
}: {
  pass: PurchasedPass
  size?: keyof typeof SIZES
  tone?: keyof typeof TONES
  className?: string
}) {
  const scale = SIZES[size]
  const palette = TONES[tone]
  // A pass that is not ACTIVE has no "remaining" sessions in any sense the
  // customer can act on, whatever its counter says — it was withdrawn,
  // expired, or fully used. Reading the counter alone made a withdrawn Pass
  // advertise "8 sessions remaining" next to its own Withdrawn badge.
  //
  // The counters are deliberately left truthful by the backend when a
  // settlement is reversed (ADR-024): they record what was delivered and what
  // was not, and the pass's *status* is what says it can no longer be used.
  // This is the same rule on this side of the wire — `pass-surface.tsx`
  // derives `live` from exactly this test.
  const finished = pass.status !== 'ACTIVE' || pass.remainingSessions === 0
  const changed = useJustChanged(pass.remainingSessions)

  return (
    <div className={cn('space-y-4', className)}>
      {finished ? (
        <p className={cn('font-display font-semibold', scale.label, palette.figure)}>
          {pass.usedSessions} of {pass.originalSessions} sessions used
        </p>
      ) : (
        // The space between the spans is deliberate: flex drops a
        // whitespace-only node from the layout, but it stays in the text
        // content, so the figure and its unit read as one phrase to a screen
        // reader rather than as "7sessions remaining".
        <p className="flex items-baseline gap-2.5">
          <span
            // Keyed on the value so React replaces the node and the animation
            // runs again on the next redemption rather than only on mount.
            key={pass.remainingSessions}
            className={cn(
              'numeric font-display font-semibold',
              scale.figure,
              palette.figure,
              changed && 'animate-count-change',
            )}
          >
            {pass.remainingSessions}
          </span>{' '}
          <span className={cn(scale.label, palette.label)}>
            {pass.remainingSessions === 1 ? 'session remaining' : 'sessions remaining'}
          </span>
        </p>
      )}

      <div className="space-y-2.5">
        <SessionDots used={pass.usedSessions} total={pass.originalSessions} tone={tone} />
        {finished ? null : (
          <p className={cn(scale.meta, palette.meta)}>
            {pass.usedSessions} of {pass.originalSessions} used
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * True for a moment after `value` changes, and false on first render.
 *
 * A pass detail page that animated its own count every time it loaded would be
 * describing a state change that did not happen. This fires only when the
 * backend actually reports a different number — which, for a remaining count,
 * means a provider confirmed a session (§57).
 */
function useJustChanged(value: number): boolean {
  const previous = useRef(value)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    setChanged(true)
    const timer = setTimeout(() => setChanged(false), 400)
    return () => clearTimeout(timer)
  }, [value])

  return changed
}
