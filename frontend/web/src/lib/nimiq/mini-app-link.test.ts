import { describe, expect, it } from 'vitest'

import { miniAppOpenerUrl } from './mini-app-link'

/**
 * The browser → Nimiq Pay handoff (docs/04-NIMIQ-MINI-APPS.md §41-§44,
 * docs/05-NIMIQ-PAY-INTEGRATION.md §81-§85).
 *
 * The opener format is the documented HTTPS one:
 * https://nimpay.app/miniapps/open/your-app.com
 */

describe('miniAppOpenerUrl', () => {
  it('keeps the pass route, so Nimiq Pay opens on the same Pass', () => {
    expect(miniAppOpenerUrl('https://nimpass.app/pass/pkg_123')).toBe(
      'https://nimpay.app/miniapps/open/nimpass.app/pass/pkg_123',
    )
  })

  it('drops query and fragment, so no financial value can ride along', () => {
    // §85: a deep link may carry a pass identifier, never an authoritative
    // recipient, price or quantity.
    expect(
      miniAppOpenerUrl('https://nimpass.app/pass/pkg_123?price=1&recipient=NQ_ATTACKER#x'),
    ).toBe('https://nimpay.app/miniapps/open/nimpass.app/pass/pkg_123')
  })

  it('leaves no trailing slash for a root URL', () => {
    expect(miniAppOpenerUrl('https://nimpass.app/')).toBe(
      'https://nimpay.app/miniapps/open/nimpass.app',
    )
  })

  it('offers no handoff from localhost, where the documented path is Custom URL', () => {
    expect(miniAppOpenerUrl('http://localhost:5173/passes/pkg_123')).toBeNull()
  })

  it('offers no handoff from a LAN address', () => {
    // The dev machine's IP is reachable from the phone, but only through Nimiq
    // Pay's own Custom URL field — not through a public opener.
    expect(miniAppOpenerUrl('http://192.168.1.105:5173/passes/pkg_123')).toBeNull()
  })

  it('returns null for something that is not a URL', () => {
    expect(miniAppOpenerUrl('not a url')).toBeNull()
  })
})
