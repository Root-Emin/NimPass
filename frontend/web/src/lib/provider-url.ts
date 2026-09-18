/**
 * Where a provider lives, and what their link is.
 *
 * One place, so that every card, every "Provided by" line and the Share button
 * agree — and so a provider URL is always built from the provider's own stored
 * slug rather than from their display name. A name is not an identifier: it
 * changes, it repeats, and it contains characters a path cannot carry. The slug
 * is assigned once at creation and is immutable, which is what makes a link
 * somebody already sent keep working after a rename (docs/08-ARCHITECTURE.md
 * §80, ADR — provider slug immutability).
 *
 * The id form exists because a few records carry a provider id and no slug —
 * `Pass.providerId`, a purchase snapshot — and `/providers/:providerRef`
 * accepts both. Prefer the slug wherever the provider record is in hand.
 */

/** A provider identified by the fields any public shape carries. */
export interface ProviderRef {
  id: string
  slug?: string | null
}

/**
 * The in-app path for a provider.
 *
 * Falls back to the id when no slug is available, because the route resolves
 * both and a link that works is better than no link.
 */
export function providerPath(provider: ProviderRef): string {
  const reference = provider.slug?.trim() || provider.id
  return `/providers/${encodeURIComponent(reference)}`
}

/**
 * The absolute, shareable provider URL.
 *
 * Built from the current application origin plus the canonical route, never
 * from a hardcoded domain — the same build runs on `localhost:5173`, on a LAN
 * address during Testnet testing on a phone, and in production, and the link a
 * provider copies has to be the one that works where they are
 * (docs/04-NIMIQ-MINI-APPS.md §47).
 *
 * `origin` is injectable so this stays a pure function under test.
 */
export function providerUrl(
  provider: ProviderRef,
  origin: string = typeof window === 'undefined' ? '' : window.location.origin,
): string {
  return `${origin.replace(/\/$/, '')}${providerPath(provider)}`
}
