import type { HTMLAttributes, ReactNode } from 'react'

import { Container, type ContainerProps } from '@/components/layout/container'
import { cn } from '@/lib/utils'

/**
 * Page layout primitives.
 *
 * Section rhythm follows the spacing scale in docs/03-DESIGN-SYSTEM.md §13:
 * major page sections sit 64-96px apart on desktop and compress on mobile.
 */

/**
 * Page content container.
 *
 * Deliberately not a `<main>`: several pages render a hero or a full-bleed
 * section *outside* this component, and those must still be inside the main
 * landmark. `AppShell` owns the one `<main>` for the whole route, so this stays
 * a plain container (docs/03-DESIGN-SYSTEM.md §87).
 */
export function Page({
  className,
  width,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { width?: ContainerProps['width'] }) {
  return (
    <Container width={width} className={cn('py-10 sm:py-14', className)} {...props}>
      {children}
    </Container>
  )
}

export interface PageHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="space-y-2">
        {eyebrow ? (
          <p className="text-micro font-medium uppercase tracking-[0.08em] text-ink-subtle">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-h1 text-ink">{title}</h1>
        {description ? (
          <p className="max-w-xl text-body-lg text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-3">{actions}</div> : null}
    </header>
  )
}

export function Section({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('mt-10 sm:mt-14', className)} {...props} />
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
      <div className="space-y-1">
        <h2 className="text-h2 text-ink">{title}</h2>
        {description ? <p className="text-body text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
