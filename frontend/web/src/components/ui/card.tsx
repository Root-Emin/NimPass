import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/**
 * A surface for a meaningful grouped object — a pass, a pass, a payment
 * summary. Cards are not the interface: never nest them, and never wrap plain
 * paragraphs in one (docs/03-DESIGN-SYSTEM.md §35).
 *
 * The variants exist so that "this is a distinct object" and "this is a quiet
 * grouping" stop being the same visual. §26 asks for a border only where the
 * boundary is genuinely unclear, and most groupings on a warm ground are
 * clearer with a tonal step than with another hairline.
 */
const cardVariants = cva('rounded-xl', {
  variants: {
    variant: {
      /** A real object on the page. */
      raised: 'border border-line bg-surface shadow-soft',
      /** An object that does not need to float. */
      plain: 'border border-line bg-surface',
      /** A grouping, told apart by tone rather than by a line (§26). */
      muted: 'bg-surface-muted',
      /** A container whose contents are the point — forms, inset detail. */
      inset: 'bg-surface-inset',
      /** Structure only. */
      outline: 'border border-line',
    },
    /** Hover feedback for a card that is genuinely a link (§37, §120). */
    interactive: {
      true: 'transition-[box-shadow,border-color,transform] duration-[--nimpass-duration-base] ease-[--nimpass-ease] hover:border-line-strong hover:shadow-lift',
      false: '',
    },
  },
  defaultVariants: { variant: 'raised', interactive: false },
})

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, interactive, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, interactive }), className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-5 sm:p-6', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-h3 text-ink', className)} {...props} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-body text-ink-muted', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center gap-3 p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
  )
}
