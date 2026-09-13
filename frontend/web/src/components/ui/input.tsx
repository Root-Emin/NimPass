import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/**
 * Inputs sit at 44px so they clear the touch-target minimum and feel
 * comfortable rather than enterprise-compact (docs/03-DESIGN-SYSTEM.md §72, §89).
 */
const controlClasses =
  'w-full rounded-md border border-line bg-surface px-3.5 text-body text-ink transition-colors placeholder:text-ink-subtle hover:border-line-strong focus:border-accent-border disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-subtle aria-[invalid=true]:border-danger'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClasses, 'h-11', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClasses, 'min-h-28 resize-y py-2.5', className)} {...props} />
}

/**
 * A styled native select.
 *
 * Native is deliberate: inside the Nimiq Pay WebView the platform picker is
 * both more usable and more accessible than a scripted listbox, and it costs
 * no extra JavaScript (docs/08-ARCHITECTURE.md §122).
 */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          controlClasses,
          'h-11 cursor-pointer appearance-none pr-10',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m4 6 4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

/** Prefix/suffix wrapper, e.g. the NIM unit on a price field. */
export function InputAffix({
  affix,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { affix: string }) {
  return (
    <div className="relative">
      <input className={cn(controlClasses, 'h-11 pr-16', className)} {...props} />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-small font-medium text-ink-subtle">
        {affix}
      </span>
    </div>
  )
}
