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
  catalog: {
    all: ['catalog'] as const,
    /** The public catalogue, keyed by the server-side category filter. */
    list: (category = '') => ['catalog', 'list', category] as const,
    detail: (id: string) => ['catalog', 'detail', id] as const,
    categories: () => ['catalog', 'categories'] as const,
  },
  providers: {
    all: ['providers'] as const,
    detail: (providerId: string) => ['providers', 'detail', providerId] as const,
    bySlug: (slug: string) => ['providers', 'slug', slug] as const,
    /** The whole public provider directory. */
    directory: () => ['providers', 'directory'] as const,
    /** One provider's public storefront. */
    passes: (providerId: string) => ['providers', 'passes', providerId] as const,
  },
  passes: {
    all: ['passes'] as const,
    /** One walk of `GET /passes`, keyed by the status filter it was started with. */
    mine: (status = '') => ['passes', 'mine', status] as const,
    detail: (id: string) => ['passes', 'detail', id] as const,
    /** One pass's session records — the list both parties read. */
    sessions: (id: string) => ['passes', 'sessions', id] as const,
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
    catalog: () => ['provider', 'catalog'] as const,
    catalogPass: (id: string) => ['provider', 'catalog', id] as const,
    sold: () => ['provider', 'sold'] as const,
    /** Passes sold from one provider's catalogue. */
    soldPasses: (providerId: string) => ['provider', 'sold-passes', providerId] as const,
  },
} as const
