import { PASS_ACCENT_IDS, PASS_ACCENTS, type PassAccent } from '@/lib/pass-accent'
import { cn } from '@/lib/utils'

/**
 * Six swatches, one choice. The colour is stored as a token on the pass,
 * not as a hex the customer could never reproduce.
 */
export function AccentPicker({
  value,
  onChange,
  labelledBy,
  className,
}: {
  value: PassAccent
  onChange: (next: PassAccent) => void
  labelledBy: string
  className?: string
}) {
  return (
    // gap-3 is what makes the touch areas below fit without overlapping:
    // 12px of gap for 6px of overhang on each neighbouring swatch.
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={cn('flex flex-wrap gap-3', className)}
    >
      {PASS_ACCENT_IDS.map((id) => {
        const tone = PASS_ACCENTS[id]
        const selected = id === value
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={tone.label}
            onClick={() => onChange(id)}
            className={cn(
              'size-8 rounded-full shadow-soft transition-[transform,box-shadow] duration-[--nimpass-duration-base]',
              // The dot stays 32px; the tappable area is 44px on a phone, which
              // is what docs/03-DESIGN-SYSTEM.md §89 asks for. Drawn with a
              // pseudo-element so the design is untouched and only the finger
              // notices.
              'relative after:absolute after:-inset-1.5 after:rounded-full after:content-[\'\'] sm:after:hidden',
              selected ? 'scale-110 ring-2 ring-offset-2 ring-offset-surface' : 'hover:scale-105',
            )}
            style={{
              backgroundImage: `linear-gradient(140deg, ${tone.from}, ${tone.to})`,
              boxShadow: selected ? `0 0 0 2px ${tone.from}` : undefined,
            }}
          />
        )
      })}
    </div>
  )
}
