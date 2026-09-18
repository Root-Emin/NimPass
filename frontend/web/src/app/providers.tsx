import { QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { createQueryClient } from '@/app/query-client'
import { SessionProvider } from '@/app/session-provider'
import { WalletProvider } from '@/app/wallet-provider'
import { ToastProvider } from '@/components/ui/toast'

/**
 * Application-wide providers.
 *
 * The query client is the only home for server state (docs/08-ARCHITECTURE.md
 * §78). Retries are deliberately narrow: a network blip is worth retrying, a
 * domain rejection ("this pass is completed") is not.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <SessionProvider>
          {/* Outermost of the UI providers so any screen can confirm an action,
              and inside the data providers so a confirmation can be raised from
              a mutation callback. */}
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </WalletProvider>
    </QueryClientProvider>
  )
}
