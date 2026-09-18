import { accentFromSeed, PASS_ACCENTS, type PassAccentTone } from '@/lib/pass-accent'

/**
 * The derived-identity palette.
 *
 * Six earth-and-ink pairs that sit beside the warm neutrals without competing
 * with the product accent, and nothing in the neon range docs/03-DESIGN-SYSTEM.md
 * §20 rules out. Objects the contract gives no image — providers, services —
 * get a stable colour computed from their own name, so the same provider is
 * the same pine on every screen, for every visitor.
 *
 * Pass colour is a separate choice (`lib/pass-accent`): the provider
 * picks it. This file is only the hash fallback for things with no stored tone.
 *
 * Lives in `lib` rather than beside the component so that files importing only
 * the function do not import components too (React Fast Refresh).
 */

export type MarkTone = Pick<PassAccentTone, 'from' | 'to'>

/** Stable, order-independent hash. Same name → same tone, forever. */
export function markTone(seed: string): MarkTone {
  const accent = PASS_ACCENTS[accentFromSeed(seed)]
  return { from: accent.from, to: accent.to }
}
