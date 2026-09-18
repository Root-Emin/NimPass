import type { ReactNode } from 'react'

import { PassCoverArt } from '@/components/catalog/pass-cover-art'
import { cn } from '@/lib/utils'
import { formatNim, formatSessions } from '@/lib/format'
import { PASS_ACCENTS, resolveAccent, type PassAccent } from '@/lib/pass-accent'
import { serviceKind } from '@/lib/service-kind'
import type { Luna } from '@/types/domain'

/**
 * The cover, on the left of the pass creation screen.
 *
 * This column is the object a customer will meet on Discover: a photograph
 * when the provider has uploaded one, otherwise the accent field. The cover
 * uses the same 16×10 frame as every other pass card, so the crop the
 * provider sees here is the crop customers see on a phone and on a desktop.
 * The foot underneath carries the name, the provider and the price — the same
 * information, in the same order, as the real card.
 *
 * Empty values stay visibly empty. A preview that invents "10 sessions" before
 * the provider has typed a number is a preview of something that does not
 * exist.
 */
export function PassPreview({
  title,
  serviceName,
  providerName,
  sessions,
  priceLuna,
  accent,
  coverSrc,
  action,
  compact = false,
  className,
}: {
  title: string
  serviceName: string | null
  providerName: string | null
  /** `null` until a whole number has been typed. */
  sessions: number | null
  /** `null` until a valid NIM amount has been typed. */
  priceLuna: Luna | null
  accent: PassAccent
  coverSrc?: string | null
  /** Control floated over the corner of the artwork. */
  action?: ReactNode
  /**
   * Artwork only — no foot, no caption.
   *
   * The confirmation dialog writes the terms out beside the preview, so the
   * card's own summary would say everything twice.
   */
  compact?: boolean
  className?: string
}) {
  const kind = serviceKind(serviceName ?? '')
  const tone = PASS_ACCENTS[resolveAccent(accent, serviceName ?? '', kind.id)]
  const seed = providerName ?? serviceName ?? 'Nimpass'
  const Glyph = kind.icon

  return (
    <figure className={cn('space-y-3', className)}>
      <div
        className={cn(
          'mx-auto w-[min(100%,20.5rem)] overflow-hidden rounded-[1.75rem] border border-line bg-surface shadow-lift',
          compact ? 'rounded-2xl' : 'lg:w-full lg:rounded-3xl',
        )}
      >
        <PassCoverArt
          seed={seed}
          tone={{ from: tone.from, to: tone.to }}
          coverSrc={coverSrc ?? null}
          className="relative flex flex-col justify-between p-6 sm:p-7"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-inset ring-white/25">
              <Glyph className="size-5" aria-hidden="true" />
            </span>
            <span className="eyebrow min-w-0 truncate pt-1 text-right text-white/75">
              {serviceName ?? 'Service'}
            </span>
          </div>

          <div>
            <p
              className={cn(
                'numeric font-display text-figure font-semibold leading-none',
                sessions === null ? 'text-white/40' : 'text-white',
              )}
            >
              {sessions ?? '—'}
            </p>
            <p className="mt-1.5 text-body font-medium text-white/75">
              {sessions === 1 ? 'session' : 'sessions'}
            </p>
          </div>

          {action ? <div className="absolute inset-0 z-10">{action}</div> : null}
        </PassCoverArt>

        <div className={cn('hidden space-y-4 p-5 sm:p-6', compact ? undefined : 'lg:block')}>
          <div className="space-y-1">
            <p
              className={cn(
                'font-display text-h3 font-semibold tracking-tight',
                title.trim() ? 'text-ink' : 'text-ink-subtle',
              )}
            >
              {title.trim() || 'Pass name'}
            </p>
            {providerName ? (
              <p className="truncate text-small text-ink-muted">{providerName}</p>
            ) : null}
          </div>

          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-4">
            <span className="text-small text-ink-muted">
              {sessions === null ? '— sessions' : formatSessions(sessions)}
            </span>
            <span className="numeric font-display text-body-lg font-semibold text-ink">
              {priceLuna === null ? '— NIM' : formatNim(priceLuna)}
            </span>
          </div>
        </div>
      </div>

      {compact ? null : (
        <figcaption className="hidden px-1 text-small text-ink-subtle lg:block">
          How this pass will look wherever customers browse it.
        </figcaption>
      )}
    </figure>
  )
}
