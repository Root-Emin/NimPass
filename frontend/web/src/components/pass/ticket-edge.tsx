import { cn } from '@/lib/utils'

/**
 * The perforation across a pass: a dashed rule with a notch bitten out of each
 * side, the way a torn-off stub is shaped.
 *
 * This is the one piece of skeuomorphism the design system allows itself, and
 * it earns its place: a pass is an object the customer owns, and giving that
 * object a physical edge is what separates it from every other card on the page
 * (docs/03-DESIGN-SYSTEM.md §53). It stays a shape, not an illustration — no
 * paper texture, no drop-shadowed tear, no barcode (§107).
 *
 * The notches are cut by painting two circles in the page's own ground colour
 * and letting the parent's `overflow-hidden` clip their outer halves. That
 * means the parent must actually sit on `--color-canvas`; both callers do.
 */
export function TicketEdge({ tone = 'pass' }: { tone?: 'pass' | 'light' }) {
  return (
    <div aria-hidden="true" className="relative">
      <span className="absolute -left-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-canvas" />
      <span className="absolute -right-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-canvas" />
      <div
        className={cn(
          'border-t border-dashed',
          tone === 'pass' ? 'border-pass-line' : 'border-line-strong',
        )}
      />
    </div>
  )
}
