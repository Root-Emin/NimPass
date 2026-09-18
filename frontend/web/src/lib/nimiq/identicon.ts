import { normaliseAddress } from '@/lib/format'

/**
 * Official Nimiq Identicon for a wallet address.
 *
 * This is the identity visual from the Nimiq design kit
 * (https://nimiq.dev — Identicons Library). Generated locally from the
 * address; nothing is sent to a third-party avatar host.
 */
const cache = new Map<string, Promise<string>>()

/**
 * The text an identicon is drawn from.
 *
 * Nimiq's identicons are generated from a string, not chosen from a catalogue:
 * the library hashes the text into a face, a hat, sides, a bottom and a colour
 * pair out of its own asset set. Variant 0 is the wallet's own identicon — the
 * face ADR-010 gives every provider — and a higher variant is another face
 * derived from that same address, which is what the picker offers.
 *
 * Deriving every option from the owner's address keeps the choice tied to the
 * account rather than borrowing a face that belongs to some other wallet.
 */
export function identiconSeed(address: string, variant = 0): string {
  return variant > 0 ? `${address}#${variant}` : address
}

export function identiconDataUrl(address: string): Promise<string> {
  const key = normaliseAddress(address)
  let pending = cache.get(key)
  if (!pending) {
    pending = import('@nimiq/identicons/dist/identicons.bundle.min.js').then((module) =>
      module.default.toDataUrl(key),
    )
    cache.set(key, pending)
  }
  return pending
}
