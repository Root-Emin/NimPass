import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PurchasedPassStatusBadge } from '@/components/pass/pass-status-badge'
import { SessionDots } from '@/components/pass/session-dots'
import { TicketEdge } from '@/components/pass/ticket-edge'
import { PassCoverArt } from '@/components/catalog/pass-cover-art'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatNim } from '@/lib/format'
import { passCover, passCoverSeed } from '@/lib/pass-cover'
import type { PurchasedPass } from '@/types/domain'

/**
 * A pass in the customer's collection (docs/03-DESIGN-SYSTEM.md §48-§49).
 *
 * An active pass is rendered as the object it is: the one dark surface in the
 * product, shaped like a stub — its cover across the top, the standing and the
 * remaining count beneath it, the punch row under that, and a perforated foot
 * carrying what was paid and the way in (§50, §53). No metallic gradient, no
 * fake card number, no Apple Wallet imitation.
 *
 * The cover is the continuity between buying and owning. It is the same colour
 * field, the same service glyph and the same ghosted session count the customer
 * saw on the pass card and in the purchase preview, so a pass is recognisably
 * the thing that was bought rather than a receipt for it (`lib/pass-cover`
 * carries the one caveat: the tone is derived, because the `Pass` snapshot has
 * no accent of its own).
 *
 * Hierarchy below the cover follows §49 exactly: service, provider, status,
 * remaining, progress — and nothing else. The purchase date and price sit
 * *below* the perforation because they are provenance, not the headline (§49
 * "avoid showing unnecessary transaction details").
 *
 * Anything that can no longer be used keeps its cover but loses the dark
 * material. A completed pass stays available and readable, but it must not
 * compete with the passes the customer can use today (§60).
 *
 * Everything the card shows comes off the pass itself: the pass title, the
 * service and provider names and the price are purchased snapshots the backend
 * returns, so a grid of passes costs one request and shows what was bought
 * rather than what the provider happens to be called today
 * (docs/08-ARCHITECTURE.md §41).
 */
export function PassCard({ pass, coverSrc = null }: { pass: PurchasedPass; coverSrc?: string | null }) {
  const providerName = pass.providerName
  const priceLuna = pass.priceLuna

  if (pass.status !== 'ACTIVE') {
    return <FinishedPassCard pass={pass} coverSrc={coverSrc} />
  }

  const { tone, kind } = passCover(pass)
  const Glyph = kind.icon

  return (
    <Link
      to={`/passes/${pass.id}`}
      className="group block"
      aria-label={`${pass.passTitle} — ${pass.remainingSessions} of ${pass.originalSessions} sessions remaining`}
    >
      <article className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-pass shadow-pass transition-transform duration-[--nimpass-duration-base] ease-[--nimpass-ease] group-hover:-translate-y-0.5">
        {/* The cover, as bought. The glyph sits in the same well and the count
            ghosts back the same way as on the pass card, so the two read as
            one object seen twice. */}
        <PassCoverArt
          seed={passCoverSeed(pass)}
          tone={{ from: tone.from, to: tone.to }}
          coverSrc={coverSrc}
          className="flex items-start justify-between gap-3 p-5 sm:p-6"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-inset ring-white/25">
            <Glyph className="size-[1.125rem]" aria-hidden="true" />
          </span>

          {/* Decorative: the real counts are written out below, so this never
              carries information on its own (§87). */}
          <span
            aria-hidden="true"
            className="numeric font-display text-[2.5rem] font-semibold leading-none text-white/30 sm:text-[2.75rem]"
          >
            {pass.originalSessions}
          </span>
        </PassCoverArt>

        <div className="relative flex flex-1 flex-col p-5 sm:p-6">
          {/* Status as a word rather than as a badge: on this surface the whole
              card is the status, and the word is right here (§19 — never colour
              alone). The service it belongs to leads, as it does everywhere the
              product names a pass (§36). */}
          <p className="eyebrow truncate text-pass-ink-muted">
            {pass.serviceName ? `${pass.serviceName} · Active` : 'Nimpass · Active'}
          </p>

          <div className="mt-3 flex items-start justify-between gap-5">
            <div className="min-w-0">
              <h3 className="text-h3 text-pass-ink">{pass.passTitle}</h3>
              {providerName ? (
                <p className="mt-1.5 truncate text-body text-pass-ink-muted">with {providerName}</p>
              ) : null}
            </div>

            {/* The number is the message (§51). */}
            <p className="shrink-0 text-right">
              <span className="numeric block font-display text-h1 font-semibold leading-none text-pass-ink">
                {pass.remainingSessions}
              </span>
              <span className="eyebrow mt-2 block text-pass-ink-muted">
                of {pass.originalSessions} left
              </span>
            </p>
          </div>

          <SessionDots
            used={pass.usedSessions}
            total={pass.originalSessions}
            tone="pass"
            className="mt-6"
          />
        </div>

        <TicketEdge />

        <div className="relative flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <p className="min-w-0 truncate text-small text-pass-ink-muted">
            Purchased {formatDate(pass.createdAt)}
            {priceLuna !== undefined ? ` · ${formatNim(priceLuna)}` : ''}
          </p>
          <span className="flex shrink-0 items-center gap-1.5 text-small font-medium text-pass-ink">
            Open
            <ArrowRight
              className="size-3.5 transition-transform duration-[--nimpass-duration-base] ease-[--nimpass-ease] group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
        </div>
      </article>
    </Link>
  )
}

/**
 * A pass that is over.
 *
 * Still a card, and still wearing its own cover — a finished pass is part of
 * the collection and should be recognisable in it. What it gives up is the dark
 * material and the saturated field: the cover drops to the accent's own light
 * wash, so the row of completed passes reads as a shelf rather than as a second
 * set of live ones (§60, §79).
 */
function FinishedPassCard({ pass, coverSrc }: { pass: PurchasedPass; coverSrc: string | null }) {
  const providerName = pass.providerName
  const { tone, kind } = passCover(pass)
  const Glyph = kind.icon

  return (
    <Card variant="muted" interactive className="group h-full overflow-hidden">
      <Link
        to={`/passes/${pass.id}`}
        className="flex h-full flex-col"
        aria-label={`${pass.passTitle} — ${pass.status.toLowerCase()}`}
      >
        {coverSrc ? (
          /* The pass it was bought as, kept in the shared cover frame so a
             finished pass lines up with every other card in the grid. The
             material stays quiet: the image is dimmed rather than saturated. */
          <PassCoverArt
            seed={passCoverSeed(pass)}
            tone={{ from: tone.from, to: tone.to }}
            coverSrc={coverSrc}
            className="flex items-start justify-end p-4 opacity-80"
          >
            <PurchasedPassStatusBadge status={pass.status} />
          </PassCoverArt>
        ) : (
          <div
            className="flex items-center justify-between gap-3 px-5 py-4"
            style={{ backgroundColor: tone.well }}
          >
            <span
              className="flex size-9 items-center justify-center rounded-lg bg-white/60"
              style={{ color: tone.from }}
            >
              <Glyph className="size-4" aria-hidden="true" />
            </span>
            <PurchasedPassStatusBadge status={pass.status} />
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1 p-5">
          <h3 className="truncate text-body-lg font-medium text-ink">{pass.passTitle}</h3>
          {providerName ? (
            <p className="truncate text-small text-ink-muted">with {providerName}</p>
          ) : null}
          <p className="mt-auto pt-3 text-small text-ink-subtle">{finishedSummary(pass)}</p>
        </div>
      </Link>
    </Card>
  )
}

/**
 * What happened to a pass that is no longer usable.
 *
 * Every number is the backend's. "Expired with 3 unused" is a statement about
 * the record, not a judgement — and a cancelled pass says so plainly rather
 * than being folded into "completed" (docs/03-DESIGN-SYSTEM.md §90).
 */
function finishedSummary(pass: PurchasedPass): string {
  const unused = `${pass.remainingSessions} unused`

  switch (pass.status) {
    case 'COMPLETED':
      return `all ${pass.originalSessions} sessions used`
    case 'EXPIRED':
      return pass.remainingSessions > 0 ? `expired with ${unused}` : 'expired'
    case 'CANCELLED':
      return pass.remainingSessions > 0 ? `cancelled with ${unused}` : 'cancelled'
    default:
      return `${pass.usedSessions} of ${pass.originalSessions} used`
  }
}

export function PassCardSkeleton() {
  return <Skeleton className="h-[21rem] rounded-2xl" />
}
