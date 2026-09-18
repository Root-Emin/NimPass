import { NavLink } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { Wordmark } from '@/components/layout/logo'
import { useIsAuthenticated } from '@/hooks/use-session'
import { IS_MAINNET, networkLabel } from '@/lib/nimiq'
import { cn } from '@/lib/utils'

/** Same rule as the header: private areas are listed only once signed in. */
const LINKS = [
  { to: '/discover', label: 'Discover', private: false },
  { to: '/passes', label: 'My Passes', private: true },
  { to: '/provider/passes/new', label: 'Create Pass', private: true },
] as const

/**
 * Light footer (docs/03-DESIGN-SYSTEM.md §102) — no enterprise sitemap.
 *
 * The punch row is the same three-dot mark as the logo: two sessions used,
 * one still on the pass. It is a colophon, not a status indicator, so it is
 * decorative and the network warning stays in text.
 */
export function Footer() {
  const isAuthenticated = useIsAuthenticated()
  const links = LINKS.filter((link) => !link.private || isAuthenticated)

  return (
    <footer
      className="mt-24 bg-canvas-sunken/70 sm:mt-32"
      // The last thing on the page must clear the home indicator inside the
      // Nimiq Pay WebView (docs/04-NIMIQ-MINI-APPS.md §54).
      style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}
    >
      <Container className="pt-12 sm:pt-16">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <div className="max-w-sm space-y-4">
            <Wordmark />
            <p className="text-pretty text-body-lg leading-relaxed text-ink-muted">
              Prepaid session passes you actually keep track of.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-1.5">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-11 items-center rounded-full px-4 text-body transition-colors duration-[--nimpass-duration-fast]',
                    isActive
                      ? 'bg-surface font-medium text-ink shadow-soft'
                      : 'text-ink-muted hover:bg-surface/70 hover:text-ink',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="mt-12 flex items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-accent" />
            <span className="size-1.5 rounded-full bg-accent" />
            <span className="size-1.5 rounded-full bg-accent/30" />
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="mt-6 flex flex-col gap-3 text-micro text-ink-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>Built for Nimiq.</p>
          {/* Network is worth stating only because a testnet build must never be
              mistaken for a mainnet one (docs/04-NIMIQ-MINI-APPS.md §49). */}
          {!IS_MAINNET ? (
            <p className="inline-flex w-fit items-center rounded-full border border-line bg-surface/80 px-2.5 py-1 text-ink-muted">
              {networkLabel()} build
            </p>
          ) : null}
        </div>
      </Container>
    </footer>
  )
}
