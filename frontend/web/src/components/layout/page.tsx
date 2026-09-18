import type { HTMLAttributes, ReactNode } from 'react'

import { Container, type ContainerProps } from '@/components/layout/container'
import { cn } from '@/lib/utils'

/**
 * Page layout primitives.
 *
 * Section rhythm follows the spacing scale in docs/03-DESIGN-SYSTEM.md §13:
 * major page sections sit 64-80px apart on desktop and compress on mobile.
 * Spacing carries the hierarchy before any border does (§12, §26).
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
    <Container width={width} className={cn('py-12 sm:py-16', className)} {...props}>
      {children}
    </Container>
  )
}

/**
 * A full-bleed tinted band — page intros and hero areas.
 *
 * The tone change is what separates the intro from the content below it, so
 * there is no bottom border fighting it for the same job (§26, §98).
 */
export function PageBand({
  className,
  width,
  inner,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  width?: ContainerProps['width']
  /** Classes for the inner container, usually vertical padding. */
  inner?: string
}) {
  return (
    <section className={cn('bg-canvas-sunken/70', className)} {...props}>
      <Container width={width} className={cn('py-14 sm:py-20', inner)}>
        {children}
      </Container>
    </section>
  )
}

export interface PageHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

/** The h1 block at the top of a page: what this is, then what you can do. */
export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn('flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between', className)}
    >
      <div className="max-w-2xl space-y-3">
        {eyebrow ? <p className="eyebrow text-ink-subtle">{eyebrow}</p> : null}
        <h1 className="text-h1 text-ink">{title}</h1>
        {description ? (
          <p className="max-w-xl text-pretty text-body-lg text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-3">{actions}</div> : null}
    </header>
  )
}

export function Section({
  className,
  flush = false,
  ...props
}: HTMLAttributes<HTMLElement> & {
  /**
   * Drops the leading margin for the first section on a page.
   *
   * A prop rather than `className="mt-0"`: an unprefixed utility does not
   * override a `sm:` one — both survive the merge, and the desktop margin
   * quietly returns above 640px. That is how an 80px void appears under a hero
   * that looked correct on a phone.
   */
  flush?: boolean
}) {
  return (
    <section className={cn(flush ? 'mt-0' : 'mt-14 sm:mt-20', className)} {...props} />
  )
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex items-end justify-between gap-6 sm:mb-8', className)}>
      <div className="space-y-1.5">
        <h2 className="text-h2 text-ink">{title}</h2>
        {description ? <p className="text-body text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0 pb-1">{action}</div> : null}
    </div>
  )
}

/**
 * A subsection inside a page — "The details", "Sessions used".
 *
 * A rule above the heading rather than a card around the content: the content
 * is not a separate object, it is the next part of the same page (§35, §106).
 */
export function Subsection({
  title,
  action,
  className,
  children,
}: {
  title: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('mt-12 border-t border-line pt-8 sm:mt-14', className)}>
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="text-h3 text-ink">{title}</h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
