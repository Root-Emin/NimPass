import { Shuffle } from 'lucide-react'
import { useId } from 'react'

import { AccentPicker } from '@/components/catalog/accent-picker'
import { PASS_ACCENTS, randomAccent, type PassAccent } from '@/lib/pass-accent'
import { cn } from '@/lib/utils'

/**
 * The theme row, directly under the cover it changes.
 *
 * A control that changes what you are looking at belongs next to the thing,
 * not in the list of facts about it — which is why this sits in the artwork
 * column rather than among the pass's fields. The row is the creation-screen
 * wireframe: a theme chip, and a square shuffle beside it. What it is *not*
 * is a themes gallery: Nimpass has one visual system, and the only thing
 * chosen here is which of the six pass tokens this pass carries
 * (`lib/pass-accent`). Arbitrary colour is rejected at the contract, so it
 * is not offered here either.
 */
export function AppearancePanel({
  value,
  onChange,
  className,
}: {
  value: PassAccent
  onChange: (next: PassAccent) => void
  className?: string
}) {
  const labelId = useId()
  const tone = PASS_ACCENTS[value]

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-stretch gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 shadow-soft">
          <span
            aria-hidden="true"
            className="size-10 shrink-0 rounded-xl shadow-soft"
            style={{ backgroundImage: `linear-gradient(140deg, ${tone.from}, ${tone.to})` }}
          />
          <div className="min-w-0">
            <p id={labelId} className="eyebrow text-ink-subtle">
              Theme
            </p>
            <p className="truncate text-body font-medium text-ink">{tone.label}</p>
          </div>
        </div>

        <ShuffleAccentButton
          value={value}
          onChange={onChange}
          className="h-auto w-[3.75rem] shrink-0 rounded-2xl border border-line shadow-soft"
        />
      </div>

      <AccentPicker labelledBy={labelId} value={value} onChange={onChange} />
    </div>
  )
}

/**
 * Shuffle, beside the theme chip.
 *
 * The reference puts a shuffle square next to the theme. Nimpass lands it
 * there too: it is the one control that genuinely redraws the artwork, and
 * it only ever lands on another legal token, so it cannot produce a pass the
 * backend would refuse.
 */
export function ShuffleAccentButton({
  value,
  onChange,
  className,
}: {
  value: PassAccent
  onChange: (next: PassAccent) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(randomAccent(value))}
      aria-label="Shuffle pass colour"
      className={cn(
        'flex size-11 items-center justify-center rounded-full bg-surface text-ink shadow-lift',
        'transition-transform duration-[--nimpass-duration-base] ease-[--nimpass-ease] hover:scale-105 active:scale-95',
        className,
      )}
    >
      <Shuffle className="size-4" aria-hidden="true" />
    </button>
  )
}
