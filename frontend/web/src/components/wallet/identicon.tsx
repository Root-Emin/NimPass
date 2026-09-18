import { useEffect, useState } from 'react'

import { identiconDataUrl, identiconSeed } from '@/lib/nimiq/identicon'
import { cn } from '@/lib/utils'

/**
 * Nimiq's native face for a wallet — the identicon, not a generic icon.
 * Decorative when a neighbouring label already names the control.
 */
export function Identicon({
  address,
  variant = 0,
  size = 20,
  className,
}: {
  address: string
  /** Which identicon of this address to draw. 0 is the address's own. */
  variant?: number
  size?: number
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const seed = identiconSeed(address, variant)

  useEffect(() => {
    let cancelled = false
    void identiconDataUrl(seed).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [seed])

  if (!src) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-block shrink-0 rounded-full bg-surface-inset', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('inline-block shrink-0 rounded-full', className)}
    />
  )
}
