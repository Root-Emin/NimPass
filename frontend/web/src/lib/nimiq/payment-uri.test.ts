import { describe, expect, it } from 'vitest'

import { normaliseNimiqAddress, parsePaymentUri, verifiedPaymentUri } from './payment-uri'
import type { PaymentRequest } from '@/types/domain'

/**
 * The QR payload is the one thing on the desktop checkout that a customer's
 * wallet acts on directly. These tests pin two separate properties:
 *
 *  1. the link is read the way the official encoder writes it — decimal NIM,
 *     spaces stripped, `message` carrying the reference;
 *  2. a link that disagrees with the purchase's own terms is refused rather
 *     than displayed, because by the time the backend rejects the payment the
 *     money has already moved.
 */

const ADDRESS = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const REFERENCE = 'NP1:0123456789abcdef0123456789abcdef'

function aRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    recipient: ADDRESS,
    valueLuna: 100_000_000, // 1000 NIM
    valueNim: '1000',
    data: REFERENCE,
    network: 'TESTNET',
    expiresAt: '2099-01-01T00:00:00Z',
    uri: `nimiq:${normaliseNimiqAddress(ADDRESS)}?amount=1000&message=${encodeURIComponent(REFERENCE)}`,
    ...overrides,
  }
}

describe('parsePaymentUri', () => {
  it('reads the official request-link shape', () => {
    const parsed = parsePaymentUri(aRequest().uri!)

    expect(parsed).not.toBeNull()
    expect(parsed!.recipient).toBe('NQ0700000000000000000000000000000000')
    // Decimal NIM, per nimiq-utils RequestLinkEncoding: a Luna amount is
    // divided by 100,000 before it enters the link.
    expect(parsed!.amountNim).toBe('1000')
    expect(parsed!.reference).toBe(REFERENCE)
  })

  it('accepts a link with no message, which a scanner may produce', () => {
    const parsed = parsePaymentUri('nimiq:NQ0700000000000000000000000000000000?amount=250')

    expect(parsed?.amountNim).toBe('250')
    expect(parsed?.reference).toBeNull()
  })

  it('reads fractional NIM exactly', () => {
    const parsed = parsePaymentUri('nimiq:NQ0700000000000000000000000000000000?amount=1.23456')
    expect(parsed?.amountNim).toBe('1.23456')
  })

  it.each([
    ['not a nimiq link', 'https://nimpay.app/miniapps/open/nimpass.example/purchases/x'],
    ['a bare address', 'NQ0700000000000000000000000000000000'],
    ['no amount', 'nimiq:NQ0700000000000000000000000000000000'],
    ['a zero amount', 'nimiq:NQ0700000000000000000000000000000000?amount=0'],
    ['a fraction of a Luna', 'nimiq:NQ0700000000000000000000000000000000?amount=1.234567'],
    ['a malformed address', 'nimiq:NQ07?amount=1'],
  ])('refuses %s', (_label, value) => {
    expect(parsePaymentUri(value)).toBeNull()
  })
})

describe('verifiedPaymentUri', () => {
  it('returns the server’s link when it agrees with the purchase', () => {
    expect(verifiedPaymentUri(aRequest())?.uri).toBe(aRequest().uri)
  })

  it('accepts an equivalent amount written with trailing zeros', () => {
    // 1000 and 1000.00000 are the same Luna. Comparing as integers rather than
    // as text is what makes that true here.
    const request = aRequest({
      uri: `nimiq:${normaliseNimiqAddress(ADDRESS)}?amount=1000.00000&message=${encodeURIComponent(REFERENCE)}`,
    })
    expect(verifiedPaymentUri(request)).not.toBeNull()
  })

  it('refuses a link that would underpay the Pass', () => {
    // The mission's headline case, caught before a camera ever sees it: this
    // code would open the wallet on 800 NIM for a 1000 NIM Pass.
    const request = aRequest({
      uri: `nimiq:${normaliseNimiqAddress(ADDRESS)}?amount=800&message=${encodeURIComponent(REFERENCE)}`,
    })
    expect(verifiedPaymentUri(request)).toBeNull()
  })

  it('refuses a link pointed at another wallet', () => {
    const request = aRequest({
      uri: `nimiq:NQ0700000000000000000000000000000097?amount=1000&message=${encodeURIComponent(REFERENCE)}`,
    })
    expect(verifiedPaymentUri(request)).toBeNull()
  })

  it('refuses a link carrying another purchase’s reference', () => {
    const request = aRequest({
      uri: `nimiq:${normaliseNimiqAddress(ADDRESS)}?amount=1000&message=${encodeURIComponent('NP1:' + 'b'.repeat(32))}`,
    })
    expect(verifiedPaymentUri(request)).toBeNull()
  })

  it('returns null when the backend sent no link at all', () => {
    expect(verifiedPaymentUri(aRequest({ uri: null }))).toBeNull()
  })
})
