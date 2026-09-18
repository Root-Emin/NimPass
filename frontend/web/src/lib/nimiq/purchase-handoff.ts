import { miniAppOpenerUrl } from './mini-app-link'

/**
 * The desktop → phone handoff for one purchase intent.
 *
 * Two different targets, because two different things read them:
 *
 * `opener` is tapped on the phone itself. The custom scheme hands the page
 * straight to an installed Nimiq Pay (docs/04-NIMIQ-MINI-APPS.md §40).
 *
 * `scan` is what the QR carries. It is read by the phone's camera, which
 * understands http(s) and not a private URL scheme, so the QR uses the
 * official HTTPS Mini App opener instead. Nimiq Pay's own scan button is a
 * payment scanner — it accepts CPLink, NAKA and Lightning payment requests
 * only and refuses every Mini App link — so no QR here can be aimed at it.
 *
 * What travels in either link is a locator, never money: the path carries the
 * purchase identifier and nothing else (docs/05 §85, ADR-005).
 */
export function purchaseHandoff(id: string, origin = import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid purchase identifier')
  }
  const base = new URL(origin)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Purchase handoff requires an HTTP(S) app origin without credentials.')
  }
  const page = new URL(`/purchases/${id}`, origin)
  // Official Mini App opener; encoding preserves http/LAN addresses and path
  // inside the url parameter. Device opening remains a manual release check.
  const opener = `nimiqpay://miniapp?url=${encodeURIComponent(page.href)}`
  // Null on a LAN or localhost origin, where no public opener can reach the
  // dev host (docs/04 §40 local loading). The QR then carries the page itself:
  // a camera still opens it, the phone browser offers `opener`, and the same
  // string is what Nimiq Pay's Custom URL field expects.
  const publicOpener = miniAppOpenerUrl(page.href)
  return {
    page: page.href,
    opener,
    scan: publicOpener ?? page.href,
    scanOpensNimiqPay: publicOpener !== null,
  }
}

export function walletAttemptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
