/**
 * The browser → Nimiq Pay handoff.
 *
 * Nimpass is web-first, so a customer can meet a pass in an ordinary browser
 * where no wallet exists. docs/04-NIMIQ-MINI-APPS.md §41-§44 and
 * docs/05-NIMIQ-PAY-INTEGRATION.md §81-§84 ask for that visit to *continue* in
 * Nimiq Pay on the same pass rather than restart on a homepage.
 *
 * The Developer Center documents two openers (re-checked September 2026):
 *
 *   nimiqpay://miniapp?url=your-app.com
 *   https://nimpay.app/miniapps/open/your-app.com
 *
 * The HTTPS opener is the one used here. A custom scheme fails silently on a
 * device without Nimiq Pay installed — the tap simply does nothing — whereas an
 * ordinary https link always lands somewhere the user can read. The base is
 * configurable so a change to the official format does not need a code change
 * (§40: do not hardcode stale examples).
 *
 * What travels in the link is a route, never money. The path carries the
 * pass identifier and nothing else: query and fragment are dropped, so no
 * recipient, price or quantity can be smuggled through the handoff and treated
 * as authoritative on the far side (docs/05 §85). Those values are re-read from
 * the backend inside the wallet-capable flow (§84).
 */

const DEFAULT_OPENER_BASE = 'https://nimpay.app/miniapps/open'

function openerBase(): string {
  const configured = import.meta.env.VITE_NIMIQ_PAY_OPENER_BASE?.trim()
  return (configured && configured.length > 0 ? configured : DEFAULT_OPENER_BASE).replace(/\/$/, '')
}

/**
 * True for a host Nimiq Pay could actually reach from a phone.
 *
 * Development runs on `localhost` or a LAN IP, and those are loaded through
 * Nimiq Pay's own Custom URL field — the documented local flow — not through a
 * public opener. Offering the link there would be offering a dead one.
 */
function isPubliclyReachable(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return false
  // Bare IPv4, including the private ranges a dev machine hands out.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  // A public host needs a dot; `nimpass` alone is an intranet name at best.
  return host.includes('.')
}

/**
 * The Nimiq Pay opener link for a page, or null when a handoff cannot work.
 *
 * Null is a normal answer — local development, an unreachable host, an
 * already-Nimiq-Pay runtime — and callers render their ordinary copy instead.
 */
export function miniAppOpenerUrl(href: string = currentHref()): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!isPubliclyReachable(url.hostname)) return null

  // `host` keeps a non-default port; `pathname` keeps the pass route. The
  // trailing slash of a root path is dropped so the opener gets `example.com`
  // rather than `example.com/`.
  const path = url.pathname === '/' ? '' : url.pathname
  return `${openerBase()}/${url.host}${path}`
}

function currentHref(): string {
  return typeof window === 'undefined' ? '' : window.location.href
}
