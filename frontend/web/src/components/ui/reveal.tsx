import { useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Brings a block of content in as it reaches the viewport.
 *
 * Used on the landing page only. Motion that describes a transition is what
 * §85 allows; motion applied to every screen in a product that handles money is
 * what it warns against, so nothing behind a purchase, a pass or a redemption
 * uses this.
 *
 * Two failure modes decide the implementation, and both resolve to *visible*:
 *
 *   - No `IntersectionObserver` (older runtimes, jsdom) — the content renders
 *     normally and never animates. Hiding content behind an observer that may
 *     not exist would be trading a small flourish for a blank page.
 *   - `prefers-reduced-motion` — same. The global reduced-motion rule collapses
 *     CSS durations, but this component starts content at `opacity: 0`, which
 *     no duration can undo; it has to be checked here.
 *
 * Once revealed, it stays revealed. The observer disconnects and nothing
 * animates on the way back up: content that re-hides as you scroll is a
 * distraction, not a transition.
 */
function shouldAnimate(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof IntersectionObserver !== 'function') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function Reveal({
  children,
  className,
  /** Stagger, in ms, for items revealed as a group. Kept small on purpose. */
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  // Starts true wherever animation is not possible, so the content is simply
  // there.
  const [shown, setShown] = useState(() => !shouldAnimate())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (shown) return
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setShown(true)
        observer.disconnect()
      },
      // Fires a little before the block is fully on screen, so the motion has
      // finished by the time the reader's eye arrives.
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [shown])

  return (
    <div
      ref={ref}
      className={cn(shown ? 'animate-rise' : 'opacity-0', className)}
      style={shown && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
