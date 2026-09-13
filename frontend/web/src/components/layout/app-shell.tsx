import type { ReactNode } from 'react'

import { Footer } from '@/components/layout/footer'
import { Header } from '@/components/layout/header'
import { FixtureBanner } from '@/dev/fixture-banner'

/**
 * The public application shell.
 *
 * Wraps every customer-facing route. The provider workspace will later sit on
 * the same primitives with its own navigation (docs/03-DESIGN-SYSTEM.md §103).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-dvh flex-col bg-canvas"
      // Landscape notches and curved edges cut into the sides of the Nimiq Pay
      // WebView; the vertical insets are handled where they actually matter —
      // the header, the sticky purchase bar and the footer
      // (docs/04-NIMIQ-MINI-APPS.md §54).
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-ink-inverse"
      >
        Skip to content
      </a>
      {/* Guarded at the call site so the whole banner module is dead code in a
          production build, not merely inert. */}
      {import.meta.env.DEV ? <FixtureBanner /> : null}
      <Header />
      {/*
        One main landmark for the whole route, so hero sections and other
        content rendered outside `<Page>` are still inside it.

        `tabIndex={-1}` is what makes the skip link work: moving the *scroll*
        position without moving focus leaves a keyboard user exactly where they
        were, which is the failure mode skip links exist to prevent.
      */}
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <Footer />
    </div>
  )
}
