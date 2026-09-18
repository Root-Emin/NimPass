import { createContext, useContext } from 'react'

/**
 * The toast channel, split from `toast.tsx` so that module stays
 * components-only and fast refresh keeps working — the same split
 * `button-variants.ts` and `dialog-panel.ts` make for the same reason.
 */

export type ToastTone = 'success' | 'info' | 'warning'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

export interface ToastApi {
  /** Shows one message. Returns its id so a caller can dismiss it early. */
  show: (message: string, tone?: ToastTone) => number
  dismiss: (id: number) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

/** A channel that drops everything, for a tree rendered without the provider. */
const NO_TOASTS: ToastApi = { show: () => 0, dismiss: () => {} }

/**
 * The toast API.
 *
 * Returns a no-op outside a provider rather than throwing: a component that
 * confirms something must not crash the tree because it was rendered in a test
 * harness or a preview without the shell around it. The action still happened;
 * only the confirmation is missing.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NO_TOASTS
}
