import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

/**
 * The Nimpass mark: the `np` monogram, one ribbon folded through itself.
 *
 * A raster asset rather than the drawn-in-code glyph that used to be here, so
 * the artwork is the brand's own file and not a redrawing of it. It is served
 * from `public/` at 171×128 and displayed at 28px tall, which covers 4× device
 * pixel ratio; `h-7 w-auto` rather than a square `size-7`, because the mark is
 * 4:3 and forcing it square would squash the ribbon.
 *
 * `alt=""` and `aria-hidden`: the wordmark beside it already says "Nimpass",
 * and the link that wraps both carries the accessible name. Announcing the
 * mark too would read the product name twice.
 *
 * `width`/`height` are the intrinsic pixels so the row cannot reflow while the
 * image loads — this sits in a fixed 56px header on every screen in the app.
 */
function Glyph({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={171}
      height={128}
      decoding="async"
      className={cn('h-7 w-auto shrink-0', className)}
    />
  )
}

const WORDMARK = 'inline-flex items-center gap-2.5 font-display text-body-lg font-semibold tracking-[-0.02em] text-ink'

/**
 * The wordmark as a link home. One per page — the header's.
 *
 * `min-h-11` on the link and not on `WORDMARK`: the glyph is 28px, so the link
 * box was 28px too, and this is the one control present on every screen of a
 * product whose Mini App runtime is a phone (docs/03-DESIGN-SYSTEM.md §89,
 * docs/04-NIMIQ-MINI-APPS.md §52). The header row is already 56px tall, so the
 * taller hit area changes nothing anyone can see. The footer's `Wordmark` is a
 * paragraph and needs no target at all.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(WORDMARK, 'min-h-11 sm:min-h-0', className)}
      aria-label="Nimpass — home"
    >
      <Glyph />
      Nimpass
    </Link>
  )
}

/**
 * The wordmark as plain text.
 *
 * The footer identifies the product; it does not need a second link to the
 * home page, and two links with the same accessible name is a worse experience
 * than one (§87).
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <p className={cn(WORDMARK, className)}>
      <Glyph />
      Nimpass
    </p>
  )
}
