import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/** Used where content structure is predictable (docs/03-DESIGN-SYSTEM.md §81). */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-inset', className)}
      aria-hidden="true"
      {...props}
    />
  )
}
