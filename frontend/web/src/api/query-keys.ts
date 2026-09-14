/**
 * Centralised react-query cache keys.
 *
 * Server state is cached here and nowhere else — it is never copied into a
 * separate global store that could drift from the backend
 * (docs/08-ARCHITECTURE.md §78).
 */
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    session: () => ['auth', 'session'] as const,
  },
  packages: {
    all: ['packages'] as const,
    list: () => ['packages', 'list'] as const,
    detail: (id: string) => ['packages', 'detail', id] as const,
  },
  providers: {
    all: ['providers'] as const,
    detail: (providerId: string) => ['providers', 'detail', providerId] as const,
  },
  passes: {
    all: ['passes'] as const,
    mine: () => ['passes', 'mine'] as const,
    detail: (id: string) => ['passes', 'detail', id] as const,
  },
  redemptions: {
    all: ['redemptions'] as const,
    /** One pass's consumed-session history. */
    pass: (passId: string) => ['redemptions', 'pass', passId] as const,
    /** One provider's operational history. */
    provider: (providerId: string) => ['redemptions', 'provider', providerId] as const,
    /** The read-only current-challenge probe for a pass. */
    current: (passId: string) => ['redemptions', 'current', passId] as const,
  },
  purchases: {
    all: ['purchases'] as const,
    mine: () => ['purchases', 'mine'] as const,
    detail: (id: string) => ['purchases', 'detail', id] as const,
  },
  provider: {
    all: ['provider'] as const,
    profile: () => ['provider', 'profile'] as const,
    services: () => ['provider', 'services'] as const,
    service: (id: string) => ['provider', 'services', id] as const,
    packages: () => ['provider', 'packages'] as const,
    package: (id: string) => ['provider', 'packages', id] as const,
    passes: () => ['provider', 'passes'] as const,
  },
} as const
