import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

const alertVariants = cva('flex gap-3 rounded-md border p-4 text-body', {
  variants: {
    tone: {
      neutral: 'border-line bg-surface-muted text-ink',
      info: 'border-info/20 bg-info-soft text-ink',
      success: 'border-success/20 bg-success-soft text-ink',
      warning: 'border-warning/25 bg-warning-soft text-ink',
      danger: 'border-danger/20 bg-danger-soft text-ink',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface AlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  icon?: ReactNode
  title?: ReactNode
}

/** Tone is always paired with an icon and words, never colour alone (§19). */
export function Alert({ className, tone, icon, title, children, ...props }: AlertProps) {
  return (
    <div role="status" className={cn(alertVariants({ tone }), className)} {...props}>
      {icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span> : null}
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        {children ? <div className="text-ink-muted">{children}</div> : null}
      </div>
    </div>
  )
}
