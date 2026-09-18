import type { Luna } from '@/types/domain'

/** 1 NIM = 100_000 Luna (docs/04-NIMIQ-MINI-APPS.md §19). */
export const LUNA_PER_NIM = 100_000

/** Luna is the smallest unit, so NIM carries exactly five decimals (docs/05 §8). */
const NIM_DECIMALS = 5

/**
 * The one NIM ↔ Luna conversion in the frontend (docs/05-NIMIQ-PAY-INTEGRATION.md
 * §9). Nothing else may divide or multiply by `LUNA_PER_NIM` on its own.
 */

/**
 * Splits an integer Luna amount into its whole and fractional NIM parts using
 * integer arithmetic only.
 *
 * Deliberately not `luna / LUNA_PER_NIM`: binary floating point cannot represent
 * most five-decimal values exactly, and money must not be rendered through a
 * lossy step (docs/08-ARCHITECTURE.md §75, docs/05 §153).
 */
function splitLuna(luna: Luna): { negative: boolean; whole: number; fraction: string } {
  const negative = luna < 0
  const absolute = Math.abs(Math.trunc(luna))
  return {
    negative,
    whole: Math.floor(absolute / LUNA_PER_NIM),
    // Padded to five digits, then trailing zeros trimmed: 25_050_000 → "5".
    fraction: String(absolute % LUNA_PER_NIM)
      .padStart(NIM_DECIMALS, '0')
      .replace(/0+$/, ''),
  }
}

/**
 * Formats an integer Luna amount for display.
 *
 * Presentation only. Authoritative amounts stay integer Luna end to end and are
 * never re-derived from this string (docs/08-ARCHITECTURE.md §75).
 *
 * Every Luna the amount actually contains is shown. Rounding the display would
 * mean a pass priced at 0.00001 NIM reading as "0 NIM", and the pass form
 * accepts exactly that precision — a price the customer sees must be the price
 * they are charged (docs/03-DESIGN-SYSTEM.md §123).
 */
export function formatNim(luna: Luna, options: { withSymbol?: boolean } = {}): string {
  const { withSymbol = true } = options
  const { negative, whole, fraction } = splitLuna(luna)
  // Only the integer part is grouped; the fraction is exact digits, not a float.
  const grouped = new Intl.NumberFormat('en-US').format(whole)
  const formatted = `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
  return withSymbol ? `${formatted} NIM` : formatted
}

/**
 * Converts a NIM amount the provider typed into integer Luna.
 *
 * Parsed from the decimal string rather than through `Number * 100_000`, so
 * `1.23456` cannot arrive as `123455.99999999999`. Returns null when the value
 * is not a NIM amount representable in whole Luna (docs/05 §8).
 */
export function nimToLuna(value: string): Luna | null {
  const trimmed = value.trim()
  const match = /^(\d+)(?:\.(\d{1,5}))?$/.exec(trimmed)
  if (!match) return null
  const whole = Number(match[1])
  const fraction = Number((match[2] ?? '').padEnd(NIM_DECIMALS, '0'))
  if (!Number.isSafeInteger(whole)) return null
  const luna = whole * LUNA_PER_NIM + fraction
  return Number.isSafeInteger(luna) ? luna : null
}

/** Integer Luna back to the editable NIM string a form field expects. */
export function lunaToNimInput(luna: Luna): string {
  const { negative, whole, fraction } = splitLuna(luna)
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/**
 * The per-session price, in Luna.
 *
 * Presentation only — the backend never charges this, it charges the pass
 * price. Rounded to whole Luna because Luna is indivisible.
 */
export function perSessionLuna(priceLuna: Luna, sessionCount: number): Luna | null {
  if (!Number.isFinite(sessionCount) || sessionCount <= 0) return null
  return Math.round(priceLuna / sessionCount)
}

/**
 * Compare-safe form of a Nimiq address.
 *
 * Addresses are displayed in spaced blocks and handed around unspaced, so two
 * spellings of the same wallet are common. Comparing raw strings would report a
 * wallet mismatch that does not exist.
 */
export function normaliseAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

/**
 * Shortens a wallet address for secondary copy (profile sheet, payout).
 * The signed-in header says Profile; it does not display the address.
 * Full addresses are never shown unless the user asks (docs/03 §33, §92).
 */
export function shortenAddress(address: string): string {
  const compact = address.replace(/\s+/g, '')
  if (compact.length <= 8) return compact
  return `${compact.slice(0, 4)}…${compact.slice(-2)}`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/**
 * A redemption's moment, in the reader's own timezone.
 *
 * The backend stores and compares UTC; this is presentation only. A session
 * used at 19:00 local should read as 19:00, not as the UTC instant behind it
 * (docs/08-ARCHITECTURE.md §35 on server-authoritative comparison versus client
 * presentation).
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatSessions(count: number): string {
  return `${count} ${count === 1 ? 'session' : 'sessions'}`
}

/** Remaining seconds until an ISO timestamp, floored at zero. */
export function secondsUntil(iso: string, now: number = Date.now()): number {
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return 0
  return Math.max(0, Math.floor((target - now) / 1000))
}

export function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/** Initials fallback for a provider with no image, so avatars are never empty. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Human phrasing for a pass's absolute expiry date.
 *
 * `domain.ExpirationPolicy` is an optional fixed UTC date, not a duration —
 * its own comment says a relative-duration policy "needs a separate product
 * decision before use", so nothing here converts one into days.
 *
 * It takes a date rather than `string | null` on purpose: a pass with no
 * expiry says nothing about expiry anywhere in the product, so there is no
 * phrase for the absence of one and no way to print it by accident.
 */
export function formatExpiry(expiresAt: string): string {
  return `Valid until ${formatDate(expiresAt)}`
}

/** Month heading for a grouped timeline — "September 2026". */
export function formatMonth(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date)
}

/**
 * The readable head of an identifier.
 *
 * A pass id is a UUID, and printing all 36 characters on the detail panel
 * buries the facts that matter underneath it. This shows the first block — a
 * real prefix of the real id, never a re-formatted or invented reference code —
 * and callers put the full value in a `title` so it can still be read out.
 */
export function shortenId(id: string): string {
  const head = id.split('-')[0] ?? id
  return head.toUpperCase()
}

/**
 * A Nimiq transaction hash, short enough to sit on one line.
 *
 * `shortenId` is for UUIDs: it takes the text before the first hyphen, and a
 * transaction hash has none — so it returned all 64 characters, which on the
 * payment success screen was a three-line wall of hex where a quiet receipt
 * line was meant to be.
 *
 * Head and tail rather than a prefix, because that is how a hash is recognised
 * against a block explorer. It is a real substring of the real hash, never a
 * re-formatted or invented reference; callers put the whole value in a `title`
 * so it can still be read out in full.
 */
export function shortenHash(hash: string): string {
  const value = hash.trim()
  if (value.length <= 20) return value
  return `${value.slice(0, 8)}…${value.slice(-8)}`
}
