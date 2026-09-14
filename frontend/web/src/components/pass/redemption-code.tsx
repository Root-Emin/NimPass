import { useEffect, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { formatCountdown, secondsUntil } from '@/lib/format'
/**
 * Renders an authorised redemption reference for the provider to scan.
 *
 * The QR encodes the backend's `redemptionReference` and nothing else — no
 * wrapper object, no pass id, no identity, no long-lived secret. A static
 * pass-level QR would be a permanent bearer credential; this one is minted per
 * authorisation, lives five minutes, and dies on first use
 * (docs/09-SECURITY.md §45-§49, §11-§12 of this milestone).
 *
 * Screenshots are assumed to happen, so the countdown is a courtesy rather than
 * a control: expiry, single use and provider binding are all enforced server
 * side, and this component only describes what the backend already guarantees.
 */
export function RedemptionCode({
  reference,
  expiresAt,
}: {
  /** The exact `NR1:` reference from the authorization or rotation response. */
  reference: string
  expiresAt: string
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(() => secondsUntil(expiresAt))

  // The QR encoder is only ever needed on this surface, so it is loaded on
  // demand rather than shipped in the initial bundle.
  useEffect(() => {
    let cancelled = false
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(reference, {
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
  }, [reference])

  // The interval is the external system; the initial value comes from the
  // state initialiser. Callers remount this on a new challenge via `key`.
  useEffect(() => {
    const timer = setInterval(() => setRemaining(secondsUntil(expiresAt)), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  const expired = remaining <= 0

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="rounded-lg border border-line bg-surface p-4">
        {dataUrl ? (
          <img
            src={dataUrl}
            // The reference is spelled out in text below, so the image itself
            // carries no information a screen reader needs (§43).
            alt=""
            role="presentation"
            /*
             * Sized in viewport units with a ceiling rather than fixed pixels:
             * a 220px square is comfortable on a modern phone and dominates a
             * small one, and the same sheet has to work on both. Capped so it
             * never grows absurd on a desktop (§44).
             */
            width={220}
            height={220}
            style={{ width: 'min(220px, 55vw)', height: 'auto' }}
            className={expired ? 'opacity-30 transition-opacity' : 'transition-opacity'}
          />
        ) : (
          <Skeleton className="aspect-square w-[min(220px,55vw)]" />
        )}
      </div>

      <div className="space-y-1.5 text-center">
        {/*
          The readable half of the same reference. A QR is unusable to a screen
          reader and to anyone whose provider has no working camera, so the code
          is always present as selectable text — the manual path is a
          first-class route, not a fallback (§37, §43).
        */}
        <p className="break-all font-mono text-body font-medium tracking-[0.08em] text-ink">
          <span className="sr-only">Session code: </span>
          {reference}
        </p>
        {/*
          The countdown ticks every second, which makes it the wrong thing to
          put in a live region: a screen reader would read a new time out loud
          sixty times a minute and bury everything else on the page.
          `aria-hidden` on the ticking text, and a separate polite region that
          only changes at thresholds a person would actually want announced
          (§43).
        */}
        <p
          className={expired ? 'text-small text-warning' : 'text-small text-ink-muted'}
          aria-hidden="true"
        >
          {expired
            ? 'This code expired. No session was used.'
            : `Expires in ${formatCountdown(remaining)}`}
        </p>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement(remaining)}
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

/**
 * What a screen reader hears, and how often.
 *
 * Three announcements over five minutes rather than three hundred: the code is
 * live, it is nearly out, it is gone. Between thresholds this returns the same
 * string, so the live region stays silent because nothing changed.
 */
function announcement(remaining: number): string {
  if (remaining <= 0) return 'This code has expired. No session was used.'
  if (remaining <= 30) return 'This code expires in less than 30 seconds.'
  if (remaining <= 60) return 'This code expires in about a minute.'
  return 'Session code ready. Show it to your provider.'
}
