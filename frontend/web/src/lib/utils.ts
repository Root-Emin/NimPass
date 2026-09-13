import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merges conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Idempotency keys for money-moving and session-consuming requests
 * (docs/05-NIMIQ-PAY-INTEGRATION.md §68).
 *
 * `crypto.randomUUID()` is secure-context only, and LAN HTTP during Nimiq Pay
 * testing is not a secure context (docs/04 §47) — hence the fallback.
 */
export function createIdempotencyKey(): string {
  const cryptoRef = globalThis.crypto
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID()
  }
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    const bytes = cryptoRef.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}
