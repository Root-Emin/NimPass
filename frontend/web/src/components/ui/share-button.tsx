import { Check, Link2, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button, type ButtonProps } from '@/components/ui/button'

/**
 * Shares the current page.
 *
 * Provider and package pages are public, shareable URLs (docs/08-ARCHITECTURE.md
 * §80), and a shared link opens its destination directly (§81). Uses the native
 * share sheet where the runtime offers one — which is the common case inside the
 * Nimiq Pay WebView — and falls back to copying the link.
 */
export function ShareButton({
  title,
  text,
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  title: string
  text?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  className?: string
}) {
  // Feature detection: `navigator.share` is absent on most desktop browsers and
  // present inside the Nimiq Pay WebView. Read once, during the first render.
  const [canShare] = useState(
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
  )
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const share = async () => {
    const url = window.location.href

    if (canShare) {
      try {
        await navigator.share({ title, text, url })
        return
      } catch {
        // A dismissed share sheet is a normal outcome — fall through to copy.
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Clipboard can be blocked (notably on LAN HTTP, which is not a secure
      // context — docs/04-NIMIQ-MINI-APPS.md §47). Select the URL instead.
      window.prompt('Copy this link', url)
    }
  }

  return (
    <Button variant={variant} size={size} className={className} onClick={() => void share()}>
      {copied ? (
        <>
          <Check aria-hidden="true" />
          Link copied
        </>
      ) : (
        <>
          {canShare ? <Share2 aria-hidden="true" /> : <Link2 aria-hidden="true" />}
          Share
        </>
      )}
    </Button>
  )
}
