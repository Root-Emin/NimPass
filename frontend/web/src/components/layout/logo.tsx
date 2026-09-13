import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

/** Wordmark. Nimpass is the product; Nimiq is infrastructure (§20). */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        'inline-flex items-center gap-2 font-display text-body-lg font-bold tracking-[-0.02em] text-ink',
        className,
      )}
      aria-label="Nimpass — home"
    >
      <span className="flex size-7 items-center justify-center rounded-md bg-accent text-ink-inverse">
        <span aria-hidden="true" className="text-small font-bold">
          N
        </span>
      </span>
      Nimpass
    </Link>
  )
}
