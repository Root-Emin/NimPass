import type { ElementType, HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type Width = 'reading' | 'content' | 'wide'

const WIDTHS: Record<Width, string> = {
  reading: 'max-w-reading',
  content: 'max-w-content',
  wide: 'max-w-wide',
}

export interface ContainerProps extends HTMLAttributes<HTMLElement> {
  width?: Width
  as?: ElementType
}

/**
 * Centred content container (docs/03-DESIGN-SYSTEM.md §11).
 * Whitespace lives outside the container — pages never fill every pixel.
 */
export function Container({
  width = 'content',
  as: Component = 'div',
  className,
  ...props
}: ContainerProps) {
  return (
    <Component className={cn('mx-auto w-full px-5 sm:px-6 lg:px-8', WIDTHS[width], className)} {...props} />
  )
}
