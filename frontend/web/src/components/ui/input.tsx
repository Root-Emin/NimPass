import {
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

import { cn } from '@/lib/utils'

/**
 * Inputs sit at 44px so they clear the touch-target minimum and feel
 * comfortable rather than enterprise-compact (docs/03-DESIGN-SYSTEM.md §72, §89).
 *
 * Two tones, because a form has two shapes in Nimpass:
 *
 *   `framed` — the standalone control. A visible box on a white surface.
 *   `bare`   — the control inside a settings row, where the *row* is already
 *              the boundary and a second box inside it is one border too many
 *              (§26). It is not invisible: it takes a surface and a hairline on
 *              hover and focus, so it still reads as something you can type in
 *              (§120), and the global focus ring applies either way (§88).
 */
const controlBase =
  'w-full rounded-md text-body text-ink transition-colors placeholder:text-ink-subtle disabled:cursor-not-allowed disabled:text-ink-subtle aria-[invalid=true]:border-danger'

const TONES = {
  framed:
    'border border-line bg-surface px-3.5 hover:border-line-strong focus:border-accent-border disabled:bg-surface-muted',
  bare: 'border border-transparent bg-transparent px-3 hover:border-line hover:bg-surface focus:border-line-strong focus:bg-surface',
} as const

export type ControlTone = keyof typeof TONES

function control(tone: ControlTone | undefined, ...rest: (string | undefined)[]) {
  return cn(controlBase, TONES[tone ?? 'framed'], ...rest)
}

interface ToneProp {
  tone?: ControlTone
}

export function Input({ className, tone, ...props }: InputHTMLAttributes<HTMLInputElement> & ToneProp) {
  return <input className={control(tone, 'h-11', className)} {...props} />
}

/**
 * Multi-line text.
 *
 * `autoGrow` makes the box follow the text instead of the other way round: it
 * opens at a comfortable height and grows line by line as someone writes, so a
 * long description stays visible while it is being typed rather than
 * disappearing up a four-row window. Growth is capped (`max-h-*` on the caller,
 * or the default here) and the box scrolls past that point, so the page layout
 * around it never runs away — and on a phone the field never grows past the
 * viewport.
 *
 * The measurement is `scrollHeight` after a reset to `auto`, which is the only
 * way to let a textarea shrink again when text is deleted. A zero reading — a
 * non-layout environment such as jsdom — leaves the height alone, so the class
 * minimum still applies.
 */
export function Textarea({
  className,
  tone,
  autoGrow = false,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> &
  ToneProp & {
    autoGrow?: boolean
    ref?: Ref<HTMLTextAreaElement>
  }) {
  const own = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = own.current
    if (!autoGrow || !element) return
    element.style.height = 'auto'
    if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`
  }, [autoGrow, props.value])

  return (
    <textarea
      ref={(element) => {
        own.current = element
        if (typeof ref === 'function') ref(element)
        else if (ref) ref.current = element
      }}
      className={control(
        tone,
        'min-h-28 py-2.5',
        autoGrow ? 'max-h-[60vh] resize-none overflow-y-auto' : 'resize-y',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A styled native select.
 *
 * Native is deliberate: inside the Nimiq Pay WebView the platform picker is
 * both more usable and more accessible than a scripted listbox, and it costs
 * no extra JavaScript (docs/08-ARCHITECTURE.md §122).
 */
export function Select({
  className,
  tone,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & ToneProp) {
  return (
    <div className="relative">
      <select
        className={control(tone, 'h-11 cursor-pointer appearance-none pr-10', className)}
        {...props}
      >
        {children}
      </select>
      <svg
        className={cn(
          'pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-ink-subtle',
          tone === 'bare' ? 'right-2.5' : 'right-3.5',
        )}
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
  tone,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & ToneProp & { affix: string }) {
  return (
    <div className="relative">
      <input className={control(tone, 'h-11 pr-14', className)} {...props} />
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-small font-medium text-ink-subtle',
          tone === 'bare' ? 'right-3' : 'right-3.5',
        )}
      >
        {affix}
      </span>
    </div>
  )
}
