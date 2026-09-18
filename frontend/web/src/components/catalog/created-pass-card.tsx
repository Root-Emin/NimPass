import { Link } from 'react-router-dom'

import { PassActionsMenu } from '@/components/catalog/pass-actions-menu'
import { PassCoverArt } from '@/components/catalog/pass-cover-art'
import { PASS_COVER_RATIO_CLASS } from '@/components/catalog/pass-cover-ratios'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { resolveCoverUrl } from '@/api/media'
import { formatNim, formatSessions } from '@/lib/format'
import { PASS_ACCENTS, resolveAccent } from '@/lib/pass-accent'
import { PASS_STATUS } from '@/lib/pass-status'
import { serviceKind } from '@/lib/service-kind'
import type { Pass } from '@/types/domain'

/**
 * A Pass the signed-in wallet made, as a card.
 *
 * The same object language as the catalog card a customer meets — the cover in
 * the shared frame, the name, the sessions, the price — with the one thing a
 * customer has no use for added: whether it is live yet. There is no second
 * card design for "my" passes, because it is the same pass.
 *
 * Shared by My Store and the preview on Profile so the two cannot drift, and
 * so a change to how a created Pass looks happens in one file.
 *
 * Everything shown is on the `Pass` the backend returned. No sales figures, no
 * view counts, no revenue: `backend/openapi.yaml` has no provider-side pass or
 * sales list, and a card is not the place to invent one
 * (docs/08-ARCHITECTURE.md §11).
 *
 * The card's actions sit *outside* the link rather than inside it. A button
 * nested in an anchor is invalid HTML and behaves unpredictably — the two
 * activations compete — so the link covers the card and the action row is its
 * sibling underneath. They are collected behind one `•••` rather than laid out
 * as a row of controls: a grid of cards is a list of products, not a control
 * panel, and putting "stop selling this" next to "delete this" at thumb
 * distance is how a mis-tap becomes irreversible.
 *
 * The badge reads the status's own tone rather than a live/not-live boolean,
 * because there are now three states a provider can be looking at and two of
 * them are "not on sale" for quite different reasons: never published, and
 * taken off the shelf (`02-USER-FLOWS.md` §80).
 */
export function CreatedPassCard({ pass }: { pass: Pass }) {
  const kind = serviceKind(pass.title)
  const tone = PASS_ACCENTS[resolveAccent(pass.accent, pass.title, kind.id)]
  const status = PASS_STATUS[pass.status]

  return (
    <Card interactive className="group flex flex-col overflow-hidden">
      <Link
        to={`/provider/passes/${pass.id}/edit`}
        className="flex flex-1 flex-col"
        aria-label={`${pass.title} — ${status.label}`}
      >
        <PassCoverArt
          seed={pass.title}
          tone={{ from: tone.from, to: tone.to }}
          coverSrc={resolveCoverUrl(pass.coverUrl)}
          className="flex items-start justify-between p-4"
        >
          <Badge tone={status.tone} className="bg-white/85">
            {status.label}
          </Badge>
          <span
            aria-hidden="true"
            className="numeric self-end font-display text-[2.75rem] font-semibold leading-none text-white/35"
          >
            {pass.sessions}
          </span>
        </PassCoverArt>

        <div className="flex flex-1 flex-col gap-4 p-5 pb-4 sm:p-6 sm:pb-4">
          <h3 className="text-h3 text-ink">{pass.title}</h3>

          <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-line pt-4">
            <span className="text-body font-medium text-ink">{formatSessions(pass.sessions)}</span>
            <span className="numeric font-display text-body-lg font-semibold text-ink">
              {formatNim(pass.priceLuna)}
            </span>
          </div>
        </div>
      </Link>

      {/*
        Outside the link above, for the reason in the header comment. Quiet and
        right-aligned: opening the Pass is what this card is for, and managing
        its listing is the exception.
      */}
      <div className="flex justify-end px-5 pb-4 sm:px-6">
        <PassActionsMenu pass={pass} />
      </div>
    </Card>
  )
}

export function CreatedPassCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className={`${PASS_COVER_RATIO_CLASS} w-full rounded-none`} />
      <div className="space-y-4 p-5 sm:p-6">
        <Skeleton className="h-6 w-3/4" />
        <div className="flex justify-between border-t border-line pt-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
    </Card>
  )
}
