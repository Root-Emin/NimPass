import { ExternalLink, LayoutGrid, Package, ScanLine, Ticket, UserRound, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { cn } from '@/lib/utils'

/**
 * The provider workspace frame (docs/03-DESIGN-SYSTEM.md §62-§65).
 *
 * Same design DNA as the public product — whitespace, soft surfaces, restrained
 * controls — with more operational density. A quiet sidebar on desktop; a
 * scrollable tab strip on mobile rather than a cramped copy of the sidebar.
 * Explicitly not a blue enterprise admin theme (§65).
 */
const NAV = [
  { to: '/provider', end: true, label: 'Overview', icon: LayoutGrid },
  // Redemption is the provider's most frequent in-person action, so it sits at
  // the top of the workspace rather than several layers down (docs/02 §49, §87).
  { to: '/provider/redeem', end: false, label: 'Redeem', icon: ScanLine },
  { to: '/provider/services', end: false, label: 'Services', icon: Wrench },
  { to: '/provider/packages', end: false, label: 'Packages', icon: Package },
  { to: '/provider/passes', end: false, label: 'Passes', icon: Ticket },
  { to: '/provider/profile', end: false, label: 'Profile', icon: UserRound },
] as const

export function ProviderShell({
  children,
  publicProviderId,
}: {
  children: ReactNode
  publicProviderId?: string | null
}) {
  return (
    <Container width="wide" className="py-8 sm:py-10">
      <div className="lg:grid lg:grid-cols-[212px_minmax(0,1fr)] lg:gap-12">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-3 hidden text-micro font-medium uppercase tracking-[0.08em] text-ink-subtle lg:block">
            Workspace
          </p>

          <nav
            aria-label="Provider workspace"
            className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-body transition-colors',
                    isActive
                      ? 'bg-surface-inset font-medium text-ink'
                      : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                  )
                }
              >
                <item.icon className="size-4 shrink-0" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {publicProviderId ? (
            <div className="mt-4 hidden border-t border-line pt-4 lg:block">
              <NavLink
                to={`/providers/${publicProviderId}`}
                className="flex items-center gap-2 px-3 text-small text-ink-muted hover:text-ink"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                View public profile
              </NavLink>
            </div>
          ) : null}
        </aside>

        <div className="mt-6 min-w-0 lg:mt-0">{children}</div>
      </div>
    </Container>
  )
}

export function WorkspaceHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1.5">
        <h1 className="text-h2 text-ink">{title}</h1>
        {description ? <p className="max-w-xl text-body text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-3">{actions}</div> : null}
    </header>
  )
}
