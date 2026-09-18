import { PASS_ACCENTS, resolveAccent, type PassAccentTone } from '@/lib/pass-accent'
import { serviceKind, type ServiceKind } from '@/lib/service-kind'
import type { PurchasedPass } from '@/types/domain'

/**
 * The artwork a pass wears — the same cover the customer met when they bought
 * it (`components/catalog/pass-card.tsx`, `pass-preview.tsx`).
 *
 * A pass should look like the thing that was purchased, so the cover is built
 * from the same two inputs the pass screens use: the accent tone, and the
 * glyph inferred from the service name. Nothing here is a photograph — the
 * contract carries no pass artwork at all, and inventing one would be
 * fabricating provider data (docs/08-ARCHITECTURE.md §11).
 *
 * One caveat is worth stating plainly rather than hiding behind a default.
 * `PurchasedPass.accent` is the provider's *chosen* tone, and `PurchasedPass` does not carry
 * it: the snapshot in `backend/openapi.yaml` is `{ passTitle, serviceName,
 * providerName, priceLuna, ... }` and stops there. So this resolves the same
 * way the pass screens resolve an unset accent — deterministically from the
 * service name — which means a pass matches its pass exactly whenever the
 * provider left the tone alone, and can differ by one token when they picked
 * one. The alternative is a pass read per card, which is precisely the
 * fan-out `GET /passes` exists to avoid (docs/08-ARCHITECTURE.md §41).
 *
 * Closing that gap is a contract change (`accent` added to the `Pass`
 * snapshot), not something to paper over here.
 */
export interface PassCover {
  tone: PassAccentTone
  kind: ServiceKind
}

export function passCover(pass: Pick<PurchasedPass, 'serviceName' | 'passTitle'>): PassCover {
  const serviceName = pass.serviceName || pass.passTitle
  const kind = serviceKind(serviceName)
  return { tone: PASS_ACCENTS[resolveAccent(null, serviceName, kind.id)], kind }
}

/**
 * What the colour field is seeded from.
 *
 * The provider's name, matching `CatalogPassCard` — the highlight placement is
 * derived from the seed, so using the same one keeps a purchased pass and its catalog Pass
 * visually identical rather than merely similar.
 */
export function passCoverSeed(pass: Pick<PurchasedPass, 'providerName' | 'serviceName'>): string {
  return pass.providerName || pass.serviceName || 'Nimpass'
}
