import { Menu } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { Logo } from '@/components/layout/logo'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { WalletControl } from '@/components/wallet/wallet-control'
import { cn } from '@/lib/utils'

/**
 * Quiet navigation (docs/03-DESIGN-SYSTEM.md §31-§34): few destinations, a
 * restrained height, and a wallet control that stays visually secondary.
 * Mobile gets its own composition rather than a squeezed desktop header.
 */
const NAV_ITEMS = [
  { to: '/discover', label: 'Discover' },
  { to: '/passes', label: 'My Passes' },
  { to: '/provider', label: 'For Providers' },
] as const

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header
      className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-sm"
      /*
        The page declares `viewport-fit=cover`, so inside the Nimiq Pay WebView
        the document starts underneath the status bar and notch. Without this
        the sticky header — and the wallet control in it — sits behind them
        (docs/04-NIMIQ-MINI-APPS.md §54). It is zero on every ordinary browser.
      */
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <Container className="flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-body text-ink-muted transition-colors hover:text-ink',
                    isActive && 'text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <WalletControl />
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent title="Menu">
              <nav aria-label="Mobile" className="flex flex-col">
                {NAV_ITEMS.map((item) => (
                  <SheetClose asChild key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          'rounded-md px-2 py-3 text-body-lg text-ink-muted transition-colors',
                          isActive && 'text-ink',
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
        </div>
      </Container>
    </header>
  )
}
