import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { ApiError, messageForApiError, passSessionsApi, queryKeys } from '@/api'
import type { PassSession } from '@/types/domain'

/**
 * One pass's sessions, for whichever party is looking.
 *
 * The hook holds no session state of its own. Every write returns the row the
 * backend wrote and then invalidates the pass and its sessions, so the screen
 * re-reads rather than patching a local copy — which is the whole reason the
 * buyer and the provider cannot drift apart (docs/08-ARCHITECTURE.md §49).
 */
export function usePassSessions(passId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.passes.sessions(passId ?? ''),
    queryFn: ({ signal }) => passSessionsApi.listPassSessions(passId as string, signal),
    enabled: Boolean(passId),
  })
}

export interface SessionActions {
  /** Sets or clears one session's date. `null` clears it. */
  schedule: (session: PassSession, scheduledAt: string | null) => Promise<void>
  /** Records one session as delivered. Provider only; the backend enforces it. */
  complete: (session: PassSession) => Promise<void>
  /** The session id currently being written, so one row can show a spinner. */
  pendingId: string | null
  /** What went wrong, in words, or null. */
  error: string | null
  /** Clears the error after the user has seen it. */
  dismissError: () => void
}

export function useSessionActions(passId: string | undefined): SessionActions {
  const queryClient = useQueryClient()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Re-reads everything one session write can move: the session list, the
   * pass itself (its counters changed), and the customer's collection, where
   * the same pass shows its remaining count.
   */
  const refresh = useCallback(() => {
    if (!passId) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.passes.sessions(passId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.passes.detail(passId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.passes.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.redemptions.pass(passId) })
  }, [passId, queryClient])

  const scheduleMutation = useMutation({
    mutationFn: ({ session, scheduledAt }: { session: PassSession; scheduledAt: string | null }) =>
      passSessionsApi.scheduleSession(session.id, scheduledAt),
  })
  const completeMutation = useMutation({
    mutationFn: (session: PassSession) => passSessionsApi.completeSession(session.id),
  })

  const run = useCallback(
    async (session: PassSession, action: () => Promise<unknown>) => {
      setPendingId(session.id)
      setError(null)
      try {
        await action()
      } catch (cause) {
        // A conflict here is almost always the other party having got there
        // first, which is information rather than a fault — so the list is
        // re-read either way and the message says what the backend said.
        setError(
          cause instanceof ApiError && cause.code === 'REDEMPTION_ALREADY_CONSUMED'
            ? 'That session was already completed. The list has been refreshed.'
            : messageForApiError(cause),
        )
      } finally {
        setPendingId(null)
        refresh()
      }
    },
    [refresh],
  )

  return {
    schedule: (session, scheduledAt) =>
      run(session, () => scheduleMutation.mutateAsync({ session, scheduledAt })),
    complete: (session) => run(session, () => completeMutation.mutateAsync(session)),
    pendingId,
    error,
    dismissError: () => setError(null),
  }
}

/** The passes sold from one provider's catalogue. */
export function useProviderSoldPasses(providerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.provider.soldPasses(providerId ?? ''),
    queryFn: ({ signal }) =>
      passSessionsApi.listProviderPurchasedPasses(providerId as string, { signal }),
    enabled: Boolean(providerId),
    select: (response) => response.items,
  })
}
