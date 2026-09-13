import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api'

/**
 * The query client is the only home for server state (docs/08-ARCHITECTURE.md
 * §78). Retries are deliberately narrow: a network blip is worth retrying, a
 * domain rejection ("this pass is completed") is not.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && !error.isNetworkError) return false
          return failureCount < 2
        },
      },
      mutations: { retry: false },
    },
  })
}
