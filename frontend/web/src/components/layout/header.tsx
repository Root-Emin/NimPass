import { Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { Logo } from '@/components/layout/logo'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { WalletControl } from '@/components/wallet/wallet-control'
import { useIsAuthenticated } from '@/hooks/use-session'
import { cn } from '@/lib/utils'

/**
 * Quiet navigation (docs/03-DESIGN-SYSTEM.md §31-§34): a handful of
 * destinations, a restrained height, and an identity control that stays
 * visually secondary. Mobile gets its own composition rather than a squeezed
 * desktop header.
 *
 * The bar is a floating glass pill, not a full-bleed band. The header itself
 * is an overlay with no background, so page content — the home scatter in
 * particular — can pass behind it. Translucency is one material on one
 * element, not glassmorphism as a product style (§20/§107).
 *
 * At rest the pill is a light frost; once the page has scrolled under it the
 * surface firms up — exactly when the bar starts separating itself from the
 * content.
 *
 * Every destination here belongs to an identity, so the bar carries no
 * navigation at all until a wallet is connected: signed out, the header is a
 * logo and the way in, and the home page is what routes a visitor to Discover
 * (docs/02-USER-FLOWS.md §5 — the public product comes first, wallet
 * interaction follows a real action). With nothing to list there is also
 * nothing for the mobile menu to hold, so its trigger goes with it.
 */
/*
 * One account, two kinds of pass. The bar names both rather than hiding the
 * selling side behind a role: My Passes is what this wallet bought, My Store is
 * what it made, and Create Pass makes another. Profile is the identity control
 * on the right, which is on every screen and needs no second entry here.
 */
const NAV_ITEMS = [
  { to: '/discover', label: 'Discover' },
  { to: '/passes', label: 'My Passes' },
  { to: '/my-store', label: 'My Store' },
  { to: '/provider/passes/new', label: 'Create Pass' },
] as const

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const scrolled = useScrolledPast(8)
  const isAuthenticated = useIsAuthenticated()
  const navItems = isAuthenticated ? NAV_ITEMS : []

  return (
    <header
      className="pointer-events-none fixed inset-x-0 top-0 z-30 pb-2.5"
      /*
        The page declares `viewport-fit=cover`, so inside the Nimiq Pay WebView
        the document starts underneath the status bar and notch. Without this
        the overlay header — and the identity control in it — sits behind them
        (docs/04-NIMIQ-MINI-APPS.md §54). It is zero on every ordinary browser.
        Side insets match the shell so the pill does not slide under a notch.
      */
      style={{
        paddingTop: 'calc(0.625rem + env(safe-area-inset-top))',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <Container>
        <div
          data-scrolled={scrolled ? 'true' : undefined}
          className={cn(
            'nav-glass pointer-events-auto flex h-14 items-center justify-between gap-4 rounded-full',
            'border border-white/55 py-2 pl-5 pr-2',
            'transition-[background-color,border-color,box-shadow] duration-[--nimpass-duration-base]',
            'md:grid md:grid-cols-[1fr_auto_1fr]',
            scrolled ? 'border-white/70' : 'border-white/45',
          )}
        >
          <div className="flex items-center">
            <Logo />
          </div>

          {navItems.length > 0 ? (
            <nav aria-label="Main" className="hidden items-center gap-1 md:flex md:justify-center">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-full px-3 py-2 text-body transition-colors duration-[--nimpass-duration-fast] lg:px-3.5',
                      isActive
                        ? 'bg-surface-inset/80 font-medium text-ink'
                        : 'text-ink-muted hover:text-ink',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          ) : (
            // The pill keeps its three-column grid on desktop, so the middle
            // column still has to exist when there is nothing to put in it.
            <div className="hidden md:block" />
          )}

          <div className="flex items-center justify-end gap-2">
            <WalletControl />
            {navItems.length > 0 ? (
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                    <Menu aria-hidden="true" />
                  </Button>
                </SheetTrigger>
                <SheetContent title="Menu">
                  <nav aria-label="Mobile" className="flex flex-col gap-1">
                    {[...navItems, { to: '/profile', label: 'Profile' } as const].map((item) => (
                      <SheetClose asChild key={item.to}>
                        <NavLink
                          to={item.to}
                          className={({ isActive }) =>
                            cn(
                              'rounded-md px-3 py-3.5 text-body-lg transition-colors',
                              isActive
                                ? 'bg-surface-inset font-medium text-ink'
                                : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                            )
                          }
                        >
                          {item.label}
                        </NavLink>
                      </SheetClose>
                    ))}
                  </nav>
                </SheetContent>
              </Sheet>
            ) : null}
          </div>
        </div>
      </Container>
    </header>
  )
}

/**
 * Whether the window has scrolled past a threshold.
 *
 * Only flips at the boundary, so the header re-renders twice per page rather
 * than on every scroll frame. Passive listener, and it reads the initial
 * position on mount because a restored scroll offset is not a scroll event.
 */
function useScrolledPast(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const read = () => setScrolled(window.scrollY > threshold)
    read()
    window.addEventListener('scroll', read, { passive: true })
    return () => window.removeEventListener('scroll', read)
  }, [threshold])

  return scrolled
}
