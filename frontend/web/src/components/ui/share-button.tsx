import { Check, Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button, type ButtonProps } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast-context'

/**
 * Copies a link, and says so.
 *
 * Share used to mean the system share sheet where one existed — which is most
 * of the time inside the Nimiq Pay WebView. That is the wrong primary action
 * for this product: a provider sharing their page is almost always pasting the
 * link somewhere (a bio, a message they are already composing, a QR generator),
 * and the sheet puts a modal chooser between them and the one thing they
 * wanted. Worse, a dismissed sheet is indistinguishable from a failed one, so
 * the button often appeared to do nothing at all.
 *
 * So: one tap, one clipboard write, one small confirmation. No chooser.
 *
 * `url` is passed in rather than read from `window.location` so the link is the
 * page's *canonical* one. On a provider page those differ — the browser may be
 * on `/providers/<uuid>` or carry query parameters, and what gets shared has to
 * be the stable slug URL (`src/lib/provider-url.ts`).
 *
 * Clipboard access can legitimately fail: it needs a secure context, and LAN
 * HTTP during Testnet testing on a phone is not one
 * (docs/04-NIMIQ-MINI-APPS.md §47). That case falls back to a prompt holding
 * the selectable URL rather than reporting a success that did not happen.
 */
export function ShareButton({
  url,
  label = 'Share',
  copiedMessage = 'Link copied',
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  /** The canonical URL to copy. Defaults to the current page. */
  url?: string
  label?: string
  /** What the toast says on success. */
  copiedMessage?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    const target = url ?? (typeof window === 'undefined' ? '' : window.location.href)

    try {
      await navigator.clipboard.writeText(target)
      setCopied(true)
      toast.show(copiedMessage, 'success')
    } catch {
      // Not a failure the person can act on by pressing again, so it does not
      // become a toast: the URL itself is what they need, selectable.
      window.prompt('Copy this link', target)
    }
  }

  return (
    <Button variant={variant} size={size} className={className} onClick={() => void copy()}>
      {copied ? (
        <>
          <Check aria-hidden="true" />
          {copiedMessage}
        </>
      ) : (
        <>
          <Link2 aria-hidden="true" />
          {label}
        </>
      )}
    </Button>
  )
}
