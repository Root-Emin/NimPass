/**
 * The six earth tones a provider can assign to a pass.
 *
 * Pass details, the colour field on the pass card, and the form picker all
 * read from this table. The product accent stays pine for chrome (focus, logo,
 * status); a yoga pass and a guitar pass are allowed to look like themselves.
 *
 * Arbitrary hex is rejected at the contract — these tokens are the only legal
 * values (`backend/openapi.yaml` Pass.accent).
 */

export const PASS_ACCENT_IDS = ['PINE', 'SLATE', 'CLAY', 'OLIVE', 'PLUM', 'AMBER'] as const

export type PassAccent = (typeof PASS_ACCENT_IDS)[number]

export interface PassAccentTone {
  id: PassAccent
  label: string
  from: string
  to: string
  /** Quiet wash behind the Pass details panel. */
  wash: string
  /** Circle behind a Lucide glyph. */
  well: string
  /** Hairline on the panel. */
  line: string
}

export const PASS_ACCENTS: Record<PassAccent, PassAccentTone> = {
  PINE: {
    id: 'PINE',
    label: 'Pine',
    from: '#0e6a58',
    to: '#1b8f77',
    wash: '#eef6f3',
    well: '#d7ebe4',
    line: '#c5ddd6',
  },
  SLATE: {
    id: 'SLATE',
    label: 'Slate',
    from: '#35507a',
    to: '#557099',
    wash: '#eef2f7',
    well: '#d9e1ec',
    line: '#c5d0de',
  },
  CLAY: {
    id: 'CLAY',
    label: 'Clay',
    from: '#8a4f38',
    to: '#b1704f',
    wash: '#f7f1ee',
    well: '#eedfd6',
    line: '#e0cbbf',
  },
  OLIVE: {
    id: 'OLIVE',
    label: 'Olive',
    from: '#5c6633',
    to: '#84914c',
    wash: '#f3f4ec',
    well: '#e4e7d4',
    line: '#d3d7bc',
  },
  PLUM: {
    id: 'PLUM',
    label: 'Plum',
    from: '#6b3f5e',
    to: '#93607f',
    wash: '#f5eef3',
    well: '#eadce6',
    line: '#dcc8d5',
  },
  AMBER: {
    id: 'AMBER',
    label: 'Amber',
    from: '#8a6118',
    to: '#b08432',
    wash: '#f7f2e8',
    well: '#eee4ce',
    line: '#e0d2b3',
  },
}

export function isPassAccent(value: string | null | undefined): value is PassAccent {
  return value != null && (PASS_ACCENT_IDS as readonly string[]).includes(value)
}

/** Stable hash, same algorithm as the derived marks, so a name always lands on the same token. */
export function hashSeed(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000
  }
  return hash
}

export function accentFromSeed(seed: string): PassAccent {
  return PASS_ACCENT_IDS[hashSeed(seed) % PASS_ACCENT_IDS.length]!
}

/**
 * Starting colour when the provider has not picked yet.
 *
 * Kind-aware so a guitar pass does not open on pine just because pine is
 * the product chrome. Once they pick, `stored` wins on every screen.
 */
export function suggestAccent(serviceName: string, kindId?: string): PassAccent {
  switch (kindId) {
    case 'music':
      return 'PLUM'
    case 'fitness':
      return 'PINE'
    case 'language':
      return 'SLATE'
    case 'wellness':
      return 'OLIVE'
    case 'tutoring':
      return 'AMBER'
    case 'art':
      return 'CLAY'
    default:
      return accentFromSeed(serviceName.trim() || 'Nimpass')
  }
}

/** Wire value, or a derived fallback. Never invents a seventh colour. */
export function resolveAccent(
  stored: string | null | undefined,
  serviceName: string,
  kindId?: string,
): PassAccent {
  if (isPassAccent(stored)) return stored
  return suggestAccent(serviceName, kindId)
}

/**
 * A legal token picked at random, never the one already showing.
 *
 * Two callers: shuffle, and the colour a brand-new pass opens on. The
 * creation screen deliberately does not open on the same tone every time —
 * pine is the product's chrome, not every pass's identity — so the draft
 * starts somewhere in the range and settles on a service-derived tone as soon
 * as the provider picks a service.
 */
export function randomAccent(exclude?: PassAccent): PassAccent {
  const pool = PASS_ACCENT_IDS.filter((id) => id !== exclude)
  return pool[Math.floor(Math.random() * pool.length)]!
}
