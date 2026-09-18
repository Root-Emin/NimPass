import { describe, expect, it } from 'vitest'

import { identiconDataUrl, identiconSeed } from '@/lib/nimiq/identicon'

const WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081'

/**
 * A provider's chosen face is a number, and this is where that number becomes
 * a picture. Everything downstream — the pass card, the profile, the public
 * provider page — draws from this seed, so the rules live in one place.
 */
describe('identiconSeed', () => {
  it('leaves the wallet alone for the default face', () => {
    // Variant 0 is the address's own identicon, which is what every provider
    // shows until they pick something else (docs/DECISIONS.md ADR-010). It has
    // to be byte-identical to the seed the header and Profile already use, or
    // the same wallet would wear two faces.
    expect(identiconSeed(WALLET)).toBe(WALLET)
    expect(identiconSeed(WALLET, 0)).toBe(WALLET)
  })

  it('derives every other face from that same address', () => {
    expect(identiconSeed(WALLET, 4)).toBe(`${WALLET}#4`)
    // Two variants of one wallet are different faces of the same account,
    // never the face of a different wallet.
    expect(identiconSeed(WALLET, 4)).not.toBe(identiconSeed(WALLET, 5))
  })

  it('draws a different identicon per variant, and the same one every time', async () => {
    const [own, fourth, fourthAgain] = await Promise.all([
      identiconDataUrl(identiconSeed(WALLET, 0)),
      identiconDataUrl(identiconSeed(WALLET, 4)),
      identiconDataUrl(identiconSeed(WALLET, 4)),
    ])

    expect(own.startsWith('data:image/svg+xml')).toBe(true)
    expect(fourth).not.toBe(own)
    // Deterministic: the stored number is enough to redraw the same face for
    // every visitor, on every device, with nothing cached server-side.
    expect(fourthAgain).toBe(fourth)
  })
})
