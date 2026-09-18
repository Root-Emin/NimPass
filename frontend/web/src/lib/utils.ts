import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge, taught the Nimpass theme.
 *
 * This configuration is load-bearing, not tidiness. Out of the box
 * tailwind-merge only knows Tailwind's *default* scales, so it cannot tell a
 * custom size from a custom colour: `text-body-lg` and `text-ink` both look
 * like `text-…`, it assumes they conflict, and the later one wins. Every
 * `cn('text-body-lg …', 'text-ink')` in the app silently rendered at the
 * inherited size — the class was dropped before it ever reached the document.
 *
 * Listing the theme scales from `styles/index.css` here restores the
 * distinction: sizes conflict with sizes, colours with colours. Any token added
 * there needs adding here too, or it starts disappearing the same quiet way.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'canvas',
        'canvas-sunken',
        'surface',
        'surface-muted',
        'surface-inset',
        'ink',
        'ink-muted',
        'ink-subtle',
        'ink-inverse',
        'line',
        'line-strong',
        'accent',
        'accent-hover',
        'accent-soft',
        'accent-border',
        'pass',
        'pass-raised',
        'pass-line',
        'pass-ink',
        'pass-ink-muted',
        'success',
        'success-soft',
        'warning',
        'warning-soft',
        'danger',
        'danger-soft',
        'info',
        'info-soft',
      ],
      text: ['micro', 'small', 'body', 'body-lg', 'lead', 'h3', 'h2', 'h1', 'display', 'figure'],
      shadow: ['soft', 'lift', 'raised', 'pass'],
      font: ['sans', 'display'],
      container: ['narrow', 'reading', 'content', 'wide'],
    },
  },
})

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
