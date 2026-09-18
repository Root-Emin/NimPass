import type { ReactNode } from 'react'

import { PassCoverArt } from '@/components/catalog/pass-cover-art'
import { PurchasedPassStatusBadge } from '@/components/pass/pass-status-badge'
import { SessionBalance } from '@/components/pass/session-progress'
import { TicketEdge } from '@/components/pass/ticket-edge'
import { passCover, passCoverSeed } from '@/lib/pass-cover'
import { cn } from '@/lib/utils'
import type { PurchasedPass } from '@/types/domain'

/**
 * The pass itself — the signature surface of the product
 * (docs/03-DESIGN-SYSTEM.md §50, §53).
 *
 * A pass is an object the customer owns, so it gets its own material: the one
 * dark surface in Nimpass, a generous radius, the remaining count set as the
 * largest thing on the screen, the punch row under it, and the action behind a
 * perforation — the stub you tear off. Deliberately not an Apple Wallet
 * imitation and deliberately not an NFT card: no metallic gradient, no fake
 * card number, no holographic sheen (§53).
 *
 * The title and provider live on the *page* above this, not inside it. The page
 * heading is the pass's name either way; keeping it out of the surface is what
 * lets the object be about the one number that matters (§50, §51).
 *
 * A pass that can no longer be used drops to a quiet light surface. It stays
 * complete and readable, but a finished pass should not look like a live one
 * (§60, §79).
 *
 * The photograph, when the pass was bought wearing one, sits in the same
 * 16×10 frame as Discover and My Passes — the same picture, the same crop.
 * Without one the surface is exactly as it was: no colour band is invented to
 * fill the space.
 */
export function PassSurface({
  pass,
  coverSrc = null,
  action,
  footnote,
}: {
  pass: PurchasedPass
  /** The catalog cover this pass was bought with, when there is one. */
  coverSrc?: string | null
  /** The primary action, rendered on the stub where there is one. */
  action?: ReactNode
  /** Quiet supporting line beside the action — what it does, or why it cannot. */
  footnote?: ReactNode
}) {
  const live = pass.status === 'ACTIVE'
  const hasStub = Boolean(action || footnote)
  const { tone } = passCover(pass)

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-3xl',
        live ? 'bg-pass shadow-pass' : 'bg-surface-muted',
      )}
    >
      {live ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(100% 70% at 85% 0%, rgb(255 255 255 / 0.11), transparent 62%)',
          }}
        />
      ) : null}

      {coverSrc ? (
        <PassCoverArt
          seed={passCoverSeed(pass)}
          tone={{ from: tone.from, to: tone.to }}
          coverSrc={coverSrc}
          className={cn('relative', live ? undefined : 'opacity-85')}
        />
      ) : null}

      <div className="relative flex items-start justify-between gap-4 p-6 sm:p-9">
        <SessionBalance pass={pass} size="hero" tone={live ? 'pass' : 'light'} />
        <PurchasedPassStatusBadge status={pass.status} onPass={live} />
      </div>

      {hasStub ? (
        <>
          <TicketEdge tone={live ? 'pass' : 'light'} />
          <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-9">
            {action ? <div className="shrink-0">{action}</div> : null}
            {footnote ? (
              <p
                className={cn(
                  'text-small',
                  live ? 'text-pass-ink-muted' : 'text-ink-muted',
                )}
              >
                {footnote}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </article>
  )
}
