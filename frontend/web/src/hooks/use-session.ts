import { useContext } from 'react'

import { SessionContext, type SessionContextValue } from '@/app/session-context'

/** Reads the Nimpass application session. Server-owned, never client-derived. */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used inside <SessionProvider>')
  }
  return context
}

/** True only when the backend has confirmed an authenticated identity. */
export function useIsAuthenticated(): boolean {
  return useSession().session !== null
}
