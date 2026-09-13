import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, providerApi, queryKeys } from '@/api'
import { useSession } from '@/hooks/use-session'
import { signMessage } from '@/lib/nimiq'
import type { Pass, ServiceStatus } from '@/types/domain'

/**
 * Provider workspace server state.
 *
 * Reads are gated on a connected wallet because every provider endpoint is
 * authorised from the session — asking without one would only return
 * UNAUTHORIZED. Mutations always carry an idempotency key so a double submit
 * cannot create two services or two packages
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

export function useMyServices() {
  const providerId = useActiveProviderId()
  return useQuery({
    queryKey: queryKeys.provider.services(),
    queryFn: ({ signal }) => providerApi.listMyServices(providerId as string, signal),
    enabled: Boolean(providerId),
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

export function useMyPackages() {
  const providerId = useActiveProviderId()
  return useQuery({
    queryKey: queryKeys.provider.packages(),
    queryFn: ({ signal }) => providerApi.listMyPackages(providerId as string, signal),
    enabled: Boolean(providerId),
  })
}

export function useMyPackage(id: string | undefined) {
  const enabled = useProviderSessionReady()
  return useQuery({
    queryKey: queryKeys.provider.package(id ?? ''),
    queryFn: ({ signal }) => providerApi.getMyPackage(id as string, signal),
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
  return useQuery<{ items: Pass[] }>({
    queryKey: queryKeys.provider.passes(),
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
    mutationFn: (input: { name: string }) =>
      providerApi.updateMyProviderProfile(providerId as string, input),
    onSuccess: () => {
      // Re-read rather than patching the cache by hand: the server decides what
      // the saved profile actually looks like.
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.profile() })
    },
  })
}

/**
 * Create or update a service.
 *
 * The two calls take different bodies: `ServiceInput` for a create, and
 * `ServiceUpdate` — which additionally *requires* `status` — for an update.
 * That is not an inconsistency to paper over: an update is a full replacement
 * of the editable fields, so the status has to be stated rather than inferred.
 */
export function useSaveService(serviceId?: string) {
  const queryClient = useQueryClient()
  const providerId = useActiveProviderId()
  return useMutation({
    mutationFn: (input: { name: string; description?: string; status: ServiceStatus }) =>
      serviceId
        ? providerApi.updateService(serviceId, input)
        : providerApi.createService(providerId as string, {
            name: input.name,
            ...(input.description ? { description: input.description } : {}),
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.services() })
    },
  })
}

export function useSavePackage(packageId?: string) {
  const queryClient = useQueryClient()
  const providerId = useActiveProviderId()
  return useMutation({
    mutationFn: ({ serviceId, ...input }: providerApi.PackageInput & { serviceId: string }) =>
      packageId
        ? providerApi.updatePackage(packageId, input)
        : providerApi.createPackage(providerId as string, serviceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.packages() })
    },
  })
}

/**
 * Publishes a package.
 *
 * There is no withdraw counterpart: `backend/openapi.yaml` defines
 * `POST /packages/{id}/publish` and no deactivate transition, even though
 * `Package.status` includes UNAVAILABLE. Reported as an open contract gap
 * rather than worked around.
 *
 * Publishing can legitimately fail with 409 — the backend requires an active
 * service and a verified payout wallet — and that rejection is surfaced, never
 * pre-empted or bypassed (docs/08-ARCHITECTURE.md §147).
 */
export function usePublishPackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => providerApi.publishPackage(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.packages() })
      // A newly published package changes the public catalogue too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.packages.all })
    },
  })
}

/**
 * Payout wallet verification: challenge, then two signatures.
 *
 * Split into its own hook because it is the only provider flow that touches the
 * wallet, and because the verification is what turns a typed address into a
 * payment recipient the backend will trust (docs/09-SECURITY.md §21).
 */
export function useVerifyPayoutWallet() {
  const queryClient = useQueryClient()
  const providerId = useActiveProviderId()

  return useMutation({
    mutationFn: async (input: { wallet: string }) => {
      if (!providerId) throw new Error('No provider account')

      // 1. The backend authors the message. The client never composes it.
      const challenge = await providerApi.createPayoutChallenge(providerId, {
        wallet: input.wallet,
      })

      // 2. Two signatures over that same message, taken one at a time — the
      //    adapter refuses overlapping native dialogs, and stacking them would
      //    make it impossible for the provider to tell them apart.
      const payout = await signMessage(challenge.message)
      const owner = await signMessage(challenge.message)

      // 3. Both pairs go to the backend exactly as the wallet produced them.
      return providerApi.verifyPayoutWallet(providerId, {
        challengeId: challenge.id,
        wallet: input.wallet,
        publicKey: payout.publicKey,
        signature: payout.signature,
        ownerPublicKey: owner.publicKey,
        ownerSignature: owner.signature,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.provider.profile() })
    },
  })
}
