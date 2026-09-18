/**
 * The purchase payment QR: what it holds, and what proves it holds the right
 * thing.
 *
 * ## The payload is the backend's, not this module's
 *
 * `paymentRequest.uri` is built server-side from the Purchase Intent's
 * immutable snapshot — that is the whole point, because a QR assembled in a
 * browser is a QR a compromised browser can retarget (docs/05 §13, §14, §85).
 * Nothing here composes an address or an amount.
 *
 * What this module does is *check* it. `verifiedPaymentUri()` re-reads the
 * string the server sent and refuses it unless its recipient and amount are the
 * same ones the DTO states in its own separate fields. That is not a security
 * boundary — the real one is the backend comparing the finished transaction
 * against the chain, and it would reject a mismatched payment regardless. It is
 * there because by then the customer's money has already moved, and a QR that
 * disagrees with the terms printed beside it should never reach a camera.
 *
 * ## The format
 *
 *     nimiq:<ADDRESS>?amount=<decimal NIM>&message=<NP1 reference>
 *
 * Official request-link encoding (https://nimiq.dev/nimiq-utils/request-link-encoding
 * and nimiq-utils `RequestLinkEncoding.ts`): `amount` is decimal **NIM**, not
 * Luna — the encoder divides by 100,000 — and `message` is capped at 64 bytes.
 * The address travels with its spaces stripped.
 *
 * ## What is still unverified, and why the fallback below exists
 *
 * No official Nimiq source documents which QR payloads the Nimiq Pay in-app
 * payment scanner accepts, or whether a scanned link's `message` survives into
 * the transaction's data field. The app's own strings contradict each other on
 * the point (docs/NIMIQ-PAYMENT-QR-INVESTIGATION-2026-09-16.md, ADR-006 gate
 * G1). So the screen offers the Mini App opener alongside the payment code: if
 * a device refuses the code, the customer still has a documented way to pay the
 * same intent, and the backend settles either one identically.
 */

import { nimToLuna } from '@/lib/format'
import type { PaymentRequest } from '@/types/domain'

export interface VerifiedPaymentUri {
  /** The exact string to encode into the QR. */
  uri: string
  /** The recipient the URI names, spaces stripped, as the wallet will read it. */
  recipient: string
  /** The amount the URI names, as exact decimal NIM text. */
  amountNim: string
  /** The purchase reference carried as `message`, when one is present. */
  reference: string | null
}

/**
 * Returns the server's payment URI only when it agrees with the terms shown
 * beside it, and null otherwise.
 *
 * Null is a normal answer — an older backend, an unencodable address — and
 * callers render the handoff rather than a code they cannot vouch for.
 */
export function verifiedPaymentUri(request: PaymentRequest): VerifiedPaymentUri | null {
  if (!request.uri) return null

  const parsed = parsePaymentUri(request.uri)
  if (!parsed) return null

  if (parsed.recipient !== normaliseNimiqAddress(request.recipient)) return null
  // Compared as Luna integers, so `250` and `250.00000` cannot disagree and no
  // float ever touches a payment amount. `nimToLuna` is the frontend's single
  // conversion (docs/05 §9) and parses the decimal string rather than
  // multiplying a float, so `1.23456` cannot arrive as `123455.99999999999`.
  if (nimToLuna(parsed.amountNim) !== request.valueLuna) return null
  // A reference, if the link carries one, must be this purchase's.
  if (parsed.reference !== null && parsed.reference !== request.data) return null

  return parsed
}

/** Parses a `nimiq:` request link. Null for anything that is not one. */
export function parsePaymentUri(value: string): VerifiedPaymentUri | null {
  const [scheme, rest] = splitOnce(value, ':')
  if (scheme !== 'nimiq' || !rest) return null

  const [address, query] = splitOnce(rest, '?')
  const recipient = normaliseNimiqAddress(address ?? '')
  if (!/^NQ[0-9A-Z]{34}$/.test(recipient)) return null

  const params = new URLSearchParams(query ?? '')
  const amountNim = params.get('amount')
  if (!amountNim || !isExactDecimalNim(amountNim)) return null

  return { uri: value, recipient, amountNim, reference: params.get('message') }
}

/** Uppercase, spaces removed — the form the official encoder puts in a link. */
export function normaliseNimiqAddress(value: string): string {
  return value.replaceAll(' ', '').toUpperCase()
}

function isExactDecimalNim(value: string): boolean {
  return /^\d+(\.\d{1,5})?$/.test(value) && Number(value.replace('.', '')) > 0
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator)
  if (index < 0) return [value, undefined]
  return [value.slice(0, index), value.slice(index + 1)]
}
