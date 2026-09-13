import { Link } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { networkLabel } from '@/lib/nimiq'
import { IS_MAINNET } from '@/lib/nimiq'

/** Light footer (docs/03-DESIGN-SYSTEM.md §102) — no enterprise sitemap. */
export function Footer() {
  return (
    <footer
      className="mt-20 border-t border-line bg-canvas-sunken py-10 sm:mt-28"
      // The last thing on the page must clear the home indicator inside the
      // Nimiq Pay WebView (docs/04-NIMIQ-MINI-APPS.md §54).
      style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}
    >
      <Container className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="font-display text-body-lg font-bold text-ink">Nimpass</p>
          <p className="max-w-xs text-small text-ink-muted">
            Prepaid session packages you actually keep track of.
          </p>
        </div>

        <nav aria-label="Footer" className="flex gap-12">
          <div className="space-y-2 text-small">
            <p className="font-medium text-ink">Product</p>
            <Link to="/discover" className="block text-ink-muted hover:text-ink">
              Discover
            </Link>
            <Link to="/passes" className="block text-ink-muted hover:text-ink">
              My Passes
            </Link>
            <Link to="/provider" className="block text-ink-muted hover:text-ink">
              For Providers
            </Link>
          </div>
        </nav>
      </Container>

      <Container className="mt-8 flex flex-col gap-1 border-t border-line pt-6 text-micro text-ink-subtle sm:flex-row sm:items-center sm:justify-between">
        <p>Built for Nimiq.</p>
        {/* Network is worth stating only because a testnet build must never be
            mistaken for a mainnet one (docs/04-NIMIQ-MINI-APPS.md §49). */}
        {!IS_MAINNET ? <p>{networkLabel()} build</p> : null}
      </Container>
    </footer>
  )
}
