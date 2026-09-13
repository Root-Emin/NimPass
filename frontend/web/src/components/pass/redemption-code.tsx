import { useEffect, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { formatCountdown, secondsUntil } from '@/lib/format'
import type { RedemptionChallenge } from '@/types/domain'

/**
 * Renders a redemption challenge for the provider to scan.
 *
 * The QR encodes only the opaque, server-issued reference — no identity, no
 * pass history, no long-lived secret (docs/09-SECURITY.md §45). It is assumed
 * that screenshots happen (§46), so the countdown here is a courtesy: expiry,
 * one-time use and provider binding are all enforced by the backend (§47-§48).
 */
export function RedemptionCode({ challenge }: { challenge: RedemptionChallenge }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(() => secondsUntil(challenge.expiresAt))

  // The QR encoder is only ever needed on this surface, so it is loaded on
  // demand rather than shipped in the initial bundle.
  useEffect(() => {
    let cancelled = false
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(challenge.reference, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 512,
          color: { dark: '#1a1917', light: '#ffffff' },
        }),
      )
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [challenge.reference])

  // The interval is the external system; the initial value comes from the
  // state initialiser. Callers remount this on a new challenge via `key`.
  useEffect(() => {
    const timer = setInterval(() => setRemaining(secondsUntil(challenge.expiresAt)), 1000)
    return () => clearInterval(timer)
  }, [challenge.expiresAt])

  const expired = remaining <= 0

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="rounded-lg border border-line bg-surface p-4">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={`Session code ${challenge.reference}`}
            width={220}
            height={220}
            className={expired ? 'opacity-30 transition-opacity' : 'transition-opacity'}
          />
        ) : (
          <Skeleton className="size-[220px]" />
        )}
      </div>

      <div className="space-y-1.5 text-center">
        <p className="font-mono text-body-lg font-medium tracking-[0.14em] text-ink">
          {challenge.reference}
        </p>
        <p
          className={expired ? 'text-small text-warning' : 'text-small text-ink-muted'}
          role="status"
          aria-live="polite"
        >
          {expired
            ? 'This code expired. No session was used.'
            : `Expires in ${formatCountdown(remaining)}`}
        </p>
        {/*
          Says out loud what the security model already enforces, because a code
          that *looks* permanent invites screenshots and sharing. The guarantees
          are the backend's — short lifetime, one-time use, bound to this
          provider (docs/09-SECURITY.md §46-§49) — and this line only describes
          them. It claims nothing the server does not enforce.
        */}
        <p className="text-micro text-ink-subtle">
          One-time code, just for this session. It stops working after it's used or when the
          timer runs out.
        </p>
      </div>
    </div>
  )
}
