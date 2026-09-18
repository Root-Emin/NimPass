import { cva } from 'class-variance-authority'

/**
 * Button styling, kept beside the component but in its own module so the
 * component file exports only components (React Fast Refresh).
 *
 * `primary` is ink rather than accent: on a warm neutral ground a near-black
 * action reads calmer and keeps the accent free for identity, status and focus
 * (docs/03-DESIGN-SYSTEM.md §18, §73-§74). `accent` exists for the one place
 * where the action *is* the product's identity — using a session from a pass.
 *
 * Corners are moderate, not pills: pills belong to filters and status (§74).
 *
 * Sizing is mobile-first for the touch target in §89: every size is at least
 * 44px tall below `sm`, and only *above* it does `sm` shrink to a compact
 * desktop control — which is exactly the exception §89 allows. `sm` is the size
 * the wallet, payment and redemption actions use, and those run inside the
 * Nimiq Pay WebView on a phone (docs/04-NIMIQ-MINI-APPS.md §52-§53).
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-[--nimpass-duration-fast]',
    // A press is acknowledged by the control itself. Small enough to feel
    // rather than watch — §85 rules out anything that reads as a bounce.
    'active:scale-[0.985]',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-ink text-ink-inverse hover:bg-ink/88 active:bg-ink',
        accent: 'bg-accent text-ink-inverse hover:bg-accent-hover active:bg-accent-hover',
        secondary:
          'border border-line-strong bg-surface text-ink hover:border-ink/25 hover:bg-surface-muted',
        ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
        link: 'text-accent underline-offset-4 hover:underline',
        danger: 'bg-danger text-ink-inverse hover:bg-danger/90',
        /** For the dark pass surface, where ink-on-ink would vanish (§53). */
        onPass: 'bg-pass-ink text-pass hover:bg-white',
        onPassQuiet:
          'border border-pass-line bg-transparent text-pass-ink hover:bg-pass-raised',
      },
      size: {
        sm: 'h-11 px-3 text-small sm:h-9 [&_svg]:size-4',
        md: 'h-11 px-4 text-body [&_svg]:size-4',
        lg: 'h-12 px-6 text-body-lg [&_svg]:size-5',
        xl: 'h-14 px-7 text-body-lg [&_svg]:size-5',
        icon: 'size-11 [&_svg]:size-4',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
)
