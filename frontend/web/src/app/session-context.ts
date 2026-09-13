import { createContext } from 'react'

import type { AuthFlowState, AuthSession } from '@/types/auth'

export interface SessionContextValue {
  /** The authenticated Nimpass session, or null. Server-owned. */
  session: AuthSession | null
  /** True while the initial session recovery request is in flight. */
  isRecovering: boolean
  /** Progress of an in-flight sign-in. */
  flow: AuthFlowState
  /** Runs account access → challenge → sign → verify. */
  signIn: () => Promise<AuthSession | null>
  signOut: () => Promise<void>
  /** Clears a CANCELLED/FAILED flow so the UI can offer a clean retry. */
  resetFlow: () => void
}

export const SessionContext = createContext<SessionContextValue | null>(null)
