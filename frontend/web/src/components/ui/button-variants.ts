import { cva } from 'class-variance-authority'

/**
 * Button styling, kept beside the component but in its own module so the
 * component file exports only components (React Fast Refresh).
 *
 * `primary` is ink rather than accent: on a warm neutral ground a near-black
 * action reads calmer and keeps the accent free for identity, status and focus
 * (docs/03-DESIGN-SYSTEM.md §18, §73-§74).
 *
 * Sizing is mobile-first for the touch target in §89: every size is at least
 * 44px tall below `sm`, and only *above* it does `sm` shrink to a compact
 * desktop control — which is exactly the exception §89 allows. `sm` is the size
 * the wallet, payment and redemption actions use, and those run inside the
 * Nimiq Pay WebView on a phone (docs/04-NIMIQ-MINI-APPS.md §52-§53).
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-[--nimpass-duration-fast] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-ink-inverse hover:bg-ink/90',
        accent: 'bg-accent text-ink-inverse hover:bg-accent-hover',
        secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-muted',
        ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
        link: 'text-accent underline-offset-4 hover:underline',
        danger: 'bg-danger text-ink-inverse hover:bg-danger/90',
      },
      size: {
        sm: 'h-11 px-3 text-small sm:h-9 [&_svg]:size-4',
        md: 'h-11 px-4 text-body [&_svg]:size-4',
        lg: 'h-12 px-6 text-body-lg [&_svg]:size-5',
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
