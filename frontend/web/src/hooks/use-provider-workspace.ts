import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, providerApi, queryKeys, redemptionsApi } from '@/api'
import { useSession } from '@/hooks/use-session'
import type { Category, PurchasedPass, Service } from '@/types/domain'

/**
 * Provider workspace server state.
 *
 * Reads are gated on a connected wallet because every provider endpoint is
 * authorised from the session — asking without one would only return
 * UNAUTHORIZED. Mutations always carry an idempotency key so a double submit
 * cannot create two services or two passes
 * (docs/05-NIMIQ-PAY-INTEGRATION.md §68).
 */

/**
 * Provider reads need an authenticated Nimpass session. Whether that identity
 * is actually a provider is decided server-side from ownership and role
 * (docs/09-SECURITY.md §33, §67) — nothing here grants provider authority.
 */
function useProviderSessionReady(): boolean {
  return Boolean(useSession().session)
}

/**
 * The caller's own provider record.
 *
 * `GET /api/v1/providers` returns the providers this identity owns; Nimpass
 * currently works with the first of them. `null` means the identity is
 * authenticated but owns no provider record yet — a normal state for a customer
 * who wandered into the workspace, and not an error.
 */
export function useMyProviderProfile() {
  const enabled = useProviderSessionReady()
  return useQuery({
    queryKey: queryKeys.provider.profile(),
    queryFn: async ({ signal }) => {
      const result = await providerApi.listMyProviders(signal)
      return result.items[0] ?? null
    },
    enabled,
  })
}

/**
 * What the workspace is allowed to load right now.
 *
 * Derived from the provider record the backend actually returns, not from a
 * field on the session. The session is an identity, and which providers that
 * identity owns is a separate authorisation question the backend answers
 * (docs/09-SECURITY.md §33, §67-§68).
 *
 * This distinction is load-bearing: every downstream query is gated on a
 * provider id, so sourcing it from a session field the backend does not send
 * leaves those queries disabled — and a disabled react-query query reports
 * `isPending` forever, which renders as a skeleton that never resolves.
 */
export type ProviderAccountStatus =
  /** No Nimpass session. Sign-in is the next step. */
  | 'unauthenticated'
  /** Session exists; still finding out which providers it owns. */
  | 'loading'
  /** The provider record could not be loaded. */
  | 'error'
  /** Authenticated, but this identity owns no provider record yet. */
  | 'none'
  /** A provider record is available and the workspace can load. */
  | 'ready'

export interface ProviderAccount {
  status: ProviderAccountStatus
  providerId: string | null
  error: unknown
}

export function useProviderAccount(): ProviderAccount {
  const { session } = useSession()
  const profile = useMyProviderProfile()

  if (!session) return { status: 'unauthenticated', providerId: null, error: null }
  if (profile.isPending) return { status: 'loading', providerId: null, error: null }
  if (profile.isError) return { status: 'error', providerId: null, error: profile.error }
  if (!profile.data) return { status: 'none', providerId: null, error: null }
  return { status: 'ready', providerId: profile.data.id, error: null }
}

function useActiveProviderId(): string | null {
  return useProviderAccount().providerId
}

/**
 * Whether a provider-scoped list can be answered yet.
 *
 * Owning no provider is an *answer*, not a reason to keep a query disabled: the
 * identity owns nothing, so the list is empty. Leaving it disabled instead
 * reports `isPending` forever, which renders as a skeleton that never resolves
 * — the same failure the provider-id sourcing above exists to avoid.
 */
function useProviderListReady(): { ready: boolean; providerId: string | null } {
  const account = useProviderAccount()
  return {
    ready: account.status === 'ready' || account.status === 'none',
    providerId: account.providerId,
  }
}

export function useMyServices() {
  const { ready, providerId } = useProviderListReady()
  return useQuery({
    queryKey: queryKeys.provider.services(),
    queryFn: ({ signal }) =>
      providerId ? providerApi.listMyServices(providerId, signal) : Promise.resolve({ items: [] }),
    enabled: ready,
  })
}

export function useMyService(id: string | undefined) {
  const enabled = useProviderSessionReady()
  return useQuery({
    queryKey: queryKeys.provider.service(id ?? ''),
    queryFn: ({ signal }) => providerApi.getMyService(id as string, signal),
    enabled: enabled && Boolean(id),
  })
}

export function useMyCatalogPasses() {
  const { ready, providerId } = useProviderListReady()
  return useQuery({
    queryKey: queryKeys.provider.catalog(),
    queryFn: ({ signal }) =>
      providerId
        ? providerApi.listMyCatalogPasses(providerId, signal)
        : Promise.resolve({ items: [] }),
    enabled: ready,
  })
}

export function useMyCatalogPass(id: string | undefined) {
  const enabled = useProviderSessionReady()
  return useQuery({
    queryKey: queryKeys.provider.catalogPass(id ?? ''),
    queryFn: ({ signal }) => providerApi.getMyCatalogPass(id as string, signal),
    enabled: enabled && Boolean(id),
  })
}

/**
 * Passes sold by this provider.
 *
 * BACKEND CONTRACT STILL MISSING: `backend/openapi.yaml` has no provider pass
 * list. `GET /passes/{passID}` is the only pass endpoint, and it is scoped to
 * the *owner*, so a provider cannot reach it. The Passes screen therefore has
 * no data source and says so rather than showing an empty table that implies
 * nothing has sold.
 */
export function useProviderPasses() {
  return useQuery<{ items: PurchasedPass[] }>({
    queryKey: queryKeys.provider.sold(),
    queryFn: () => {
      throw new ApiError({
        code: 'PROVIDER_PASSES_UNAVAILABLE',
        message: 'Pass management is not available yet.',
      })
    },
    enabled: false,
    retry: false,
  })
}

/* -- Mutations ----------------------------------------------------------- */

export function useUpdateProviderProfile() {
  const queryClient = useQueryClient()
  const providerId = useActiveProviderId()
  return useMutation({
    mutationFn: (input: providerApi.ProviderProfileInput) =>
      providerApi.updateMyProviderProfile(providerId as string, input),
    onSuccess: () => {
      // Re-read rather than patching the cache by hand: the server decides what
      // the saved profile actually looks like. Public catalogue rows carry the
      // same name and identicon wallet, so they have to refresh too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.profile() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
    },
  })
}

/**
 * Resolves the provider record a pass belongs to, creating one when this
 * identity does not have it yet.
 *
 * The same move `useEnsureService` makes one level down, for the same reason.
 * A pass is created under a provider — `POST /providers/{id}/services/{sid}/passes`
 * has nowhere else to put it — but "become a provider" was a screen standing in
 * front of the form, and a setup step is exactly what ADR-008 removed from this
 * side of the product. The relation stays; the interstitial does not
 * (`docs/DECISIONS.md` ADR-020).
 *
 * Only the name is required (`ProviderInput` in `backend/openapi.yaml`); the
 * slug is generated server-side from it (ADR-017), because a provider should
 * not have to invent a URL in order to exist. The name is asked for on the form
 * rather than invented here: it is what every customer reads under every pass
 * this wallet ever sells, and no editing surface exists to correct a generated
 * one afterwards (ADR-008's known gap).
 *
 * Returns the provider id so the caller can write with it immediately, without
 * waiting for the invalidated profile query to come back.
 */
export function useEnsureProvider() {
  const queryClient = useQueryClient()
  const providerId = useActiveProviderId()

  return useMutation({
    mutationFn: async (input: { name: string }): Promise<string> => {
      if (providerId) return providerId
      const created = await providerApi.createProvider({ name: input.name.trim() })
      return created.id
    },
    onSuccess: (id) => {
      // Only when one was actually made. Every later pass resolves to the
      // record already in the cache and must not re-read the whole workspace.
      // Re-read rather than seeding it: the backend decides what this identity
      // owns, and it also decides the slug.
      if (id !== providerId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.provider.all })
      }
    },
  })
}

/**
 * Resolves the service a pass belongs to, creating and activating one when
 * there is nothing to reuse.
 *
 * Services are a domain relation, not a place in the product. A pass has to
 * belong to one — `POST /providers/{id}/services/{serviceId}/passes` is the
 * only way to create a pass — and the Pass form no longer asks about it at all:
 * `{ kind: 'auto' }` takes the pass's own name, reuses the provider's service
 * of that name if they have already sold one, and otherwise creates it. The
 * domain relation is intact; the question is gone.
 *
 * It guarantees ACTIVE, and that is load-bearing rather than tidy: a created
 * service is a DRAFT (`ServiceInput` has no status), and `POST
 * /catalog/passes/{id}/publish` rejects a pass whose service is not ACTIVE with
 * a 409. Leaving it a draft would produce a pass that can be made but never
 * published, which is the kind of dead end this whole change exists to remove.
 *
 * The two calls take different bodies: `ServiceInput` for the create, and
 * `ServiceUpdate` — which additionally *requires* `status` — for the
 * activation. That is not an inconsistency to paper over: an update is a full
 * replacement of the editable fields, so the status has to be stated.
 */
export type ServiceChoice =
  /** An existing service. Activated first if it is still a draft. */
  | { kind: 'existing'; service: Service }
  /** A service the provider just named on the Pass form. */
  | { kind: 'new'; name: string; category: Category }
  /**
   * No question was asked. Reuse the service of this name if the provider has
   * one, otherwise make it.
   *
   * `services` is what `useMyServices` already loaded, so the match costs no
   * request. A name that matches nothing creates a service with no category —
   * the contract's "unclassified" value — because the form has no taxonomy
   * control left to collect one from.
   */
  | { kind: 'auto'; name: string; services: Service[] }

/**
 * The provider to create under is passed in rather than read from the cache.
 *
 * On a first sale the provider record is made in the same submit, one step
 * earlier (`useEnsureProvider`), and the profile query that would supply its id
 * has not come back yet. Threading it through the mutation is what keeps that
 * write from going to `/providers/undefined/services`.
 */
export type EnsureServiceInput = ServiceChoice & { providerId: string }

export function useEnsureService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (choice: EnsureServiceInput): Promise<string> => {
      if (choice.kind === 'auto') {
        const wanted = choice.name.trim().toLowerCase()
        const existing = choice.services.find(
          (service) => service.status !== 'ARCHIVED' && service.name.trim().toLowerCase() === wanted,
        )
        return resolve(
          existing
            ? { kind: 'existing', service: existing, providerId: choice.providerId }
            : { kind: 'new', name: choice.name.trim(), category: '', providerId: choice.providerId },
        )
      }
      return resolve(choice)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.services() })
    },
  })

  async function resolve(choice: Exclude<EnsureServiceInput, { kind: 'auto' }>): Promise<string> {
    if (choice.kind === 'existing') {
      if (choice.service.status === 'ACTIVE') return choice.service.id
      // A service the provider used before, still a draft. Selling a pass under
      // it is the intent to use it, so activate rather than fail at the publish
      // step with a 409 about a screen that no longer exists.
      const activated = await providerApi.updateService(choice.service.id, {
        name: choice.service.name,
        ...(choice.service.description ? { description: choice.service.description } : {}),
        status: 'ACTIVE',
        category: choice.service.category,
      })
      return activated.id
    }
    const created = await providerApi.createService(choice.providerId, {
      name: choice.name,
      category: choice.category,
    })
    const activated = await providerApi.updateService(created.id, {
      name: created.name,
      status: 'ACTIVE',
      category: choice.category,
    })
    return activated.id
  }
}

export function useSavePass(passId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      serviceId,
      providerId,
      ...input
    }: providerApi.PassInput & { serviceId: string; providerId: string }) =>
      passId
        ? providerApi.updatePass(passId, input)
        : providerApi.createPass(providerId, serviceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.catalog() })
    },
  })
}

/**
 * Publishes a pass — for the first time, or back after it was withdrawn.
 *
 * The backend accepts DRAFT and UNAVAILABLE as source states, so the same call
 * covers "put this on sale" and "put this back on sale". A pass that returns
 * this way is the *same* pass: same id, same URL, same purchase history. There
 * is nothing to re-create (docs/08-ARCHITECTURE.md §34).
 *
 * Publishing can legitimately fail with 409 — the backend requires an active
 * service and a verified payout wallet, and refuses a pass that is already
 * ACTIVE or has been archived — and that rejection is surfaced, never
 * pre-empted or bypassed (docs/08-ARCHITECTURE.md §147).
 */
export function usePublishPass() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => providerApi.publishPass(id),
    onSuccess: (_pass, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.catalog() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.catalogPass(id) })
      // A newly published pass changes the public catalogue too, and can put
      // its provider back into the directory it dropped out of.
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
    },
  })
}

/**
 * Removes a pass from the listing, without deleting it.
 *
 * The counterpart to `usePublishPass`, and deliberately *not* a variant of
 * `useDeletePass`. A provider who has no slots this month should not have to
 * destroy the product to stop selling it: this sets status UNAVAILABLE, the
 * pass leaves every public surface and stops accepting purchases, and it stays
 * in My Store where it can be edited and published again
 * (docs/02-USER-FLOWS.md §80, docs/08-ARCHITECTURE.md §34).
 *
 * Nothing already sold moves. That is the backend's guarantee rather than a
 * promise made here — a purchased pass is a separate record with its own frozen
 * snapshot, and no purchase, payment, session or redemption row consults the
 * catalog pass's status (§136).
 *
 * The same four caches as a delete: the pass leaves Discover and the storefront
 * and can drop its provider out of the directory, so all of them are re-read
 * from the server rather than patched on the assumption the call worked.
 */
export function useUnpublishPass() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => providerApi.unpublishPass(id),
    onSuccess: (_pass, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.catalog() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.catalogPass(id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
    },
  })
}

/**
 * Deletes a Pass from the provider's catalogue.
 *
 * `DELETE /catalog/passes/{id}` archives it: it stops being sellable and leaves
 * both the owner's catalogue and public discovery, while the row itself stays
 * so that every purchase, payment and already-purchased customer pass that
 * references it keeps resolving (docs/08-ARCHITECTURE.md §135-§136). Nothing a
 * customer owns is touched, which is why the confirmation copy says "no longer
 * available for new purchases" rather than anything about existing passes.
 *
 * Authorisation is the backend's alone — a Pass this session does not own
 * answers 404 whatever the UI offered (docs/09-SECURITY.md §33).
 *
 * Both catalogues are invalidated rather than patched: the provider's own list
 * and the public one both change, and the server decides what each now holds.
 */
export function useDeletePass() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => providerApi.deletePass(id),
    onSuccess: (_pass, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.catalog() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.catalogPass(id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all })
      // The provider directory counts passes on sale, so removing one can move
      // a provider's count — or take them out of the directory entirely.
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
    },
  })
}

/**
 * The provider's own redemption history (`GET /providers/{providerID}/redemptions`).
 *
 * Operational, not analytical: the newest consumed sessions this provider
 * serviced, as the backend recorded them. Nothing is aggregated, averaged or
 * projected here — the contract returns rows, and rows are what this shows
 * (docs/08-ARCHITECTURE.md §11).
 */
export function useProviderRedemptions() {
  const providerId = useActiveProviderId()
  return useQuery({
    queryKey: queryKeys.redemptions.provider(providerId ?? ''),
    queryFn: ({ signal }) =>
      redemptionsApi.listProviderRedemptions(providerId as string, { signal }),
    enabled: Boolean(providerId),
    select: (response) => response.items,
  })
}
