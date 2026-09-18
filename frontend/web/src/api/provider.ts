import type { AuthChallenge, SigningScheme } from '@/types/auth'
import type {
  Category,
  Pass,
  PassAccent,
  Provider,
  Service,
  ServiceStatus,
} from '@/types/domain'

import { apiRequest } from './client'

/**
 * Provider workspace endpoints (`backend/openapi.yaml`).
 *
 * Every call is authorised server-side from the wallet session; the client
 * never identifies the provider itself, and a provider id in a path is a
 * request, not a permission (docs/09-SECURITY.md §31, §33).
 *
 * Request bodies are `additionalProperties: false` throughout, so each one
 * sends exactly the fields its schema names — an extra key is a 400, not an
 * ignored field.
 */

/* -- Provider profile ---------------------------------------------------- */

/** GET /providers → `{ items: Provider[] }`. The providers this identity owns. */
export function listMyProviders(signal?: AbortSignal): Promise<{ items: Provider[] }> {
  return apiRequest<{ items: Provider[] }>('/api/v1/providers', { signal })
}

/** GET /providers/{providerID} → `Provider`. */
export function getMyProvider(providerId: string, signal?: AbortSignal): Promise<Provider> {
  return apiRequest<Provider>(`/api/v1/providers/${encodeURIComponent(providerId)}`, { signal })
}

/**
 * The editable half of a provider profile (`ProviderInput`).
 *
 * The optional fields carry three distinct meanings, and the contract keeps
 * them apart: omitted (or null) preserves what is stored, `''` clears it, and a
 * value replaces it. So a form that edits one field must not send the others as
 * empty strings — that would erase them.
 *
 * `slug` is accepted only at creation; it is immutable afterwards, and a
 * rename never moves it.
 */
export interface ProviderProfileInput {
  name: string
  headline?: string | null
  bio?: string | null
  avatarUrl?: string | null
  avatarVariant?: number | null
  location?: string | null
}

function providerBody(input: ProviderProfileInput & { slug?: string | null }) {
  return {
    name: input.name,
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.headline !== undefined ? { headline: input.headline } : {}),
    ...(input.bio !== undefined ? { bio: input.bio } : {}),
    ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    ...(input.avatarVariant !== undefined ? { avatarVariant: input.avatarVariant } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
  }
}

/**
 * POST /providers → 201 `Provider`
 *
 * Body is `ProviderInput`. Omitting `slug` lets the backend generate a readable
 * one, which is what the workspace does: a provider should not have to invent a
 * URL to exist.
 */
export function createProvider(
  input: ProviderProfileInput & { slug?: string | null },
  options: { signal?: AbortSignal } = {},
): Promise<Provider> {
  return apiRequest<Provider>('/api/v1/providers', {
    method: 'POST',
    body: providerBody(input),
    signal: options.signal,
  })
}

/**
 * PATCH /providers/{providerID} → 200 `Provider`
 *
 * Also `ProviderInput`. The spec notes payout fields "cannot be mass-assigned":
 * a payout wallet becomes trusted only through the signed verification flow
 * below, never through a profile edit (docs/09-SECURITY.md §21-§23, §39).
 */
export function updateMyProviderProfile(
  providerId: string,
  input: ProviderProfileInput,
  options: { signal?: AbortSignal } = {},
): Promise<Provider> {
  return apiRequest<Provider>(`/api/v1/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    // No `slug`: it is immutable after creation, so sending it at all would be
    // asking for a change the contract does not allow.
    body: providerBody(input),
    signal: options.signal,
  })
}

/* -- Payout wallet verification ------------------------------------------ */

/**
 * POST /providers/{providerID}/payout-challenges → 201 `Challenge`
 *
 * Purpose `VERIFY_PROVIDER_WALLET`, domain-separated from login so a sign-in
 * signature can never be replayed to move a provider's payouts
 * (docs/09-SECURITY.md §15, §20).
 */
export function createPayoutChallenge(
  providerId: string,
  input: { wallet: string },
  options: { signal?: AbortSignal } = {},
): Promise<AuthChallenge> {
  return apiRequest<AuthChallenge>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/payout-challenges`,
    { method: 'POST', body: { wallet: input.wallet }, signal: options.signal },
  )
}

/**
 * POST /providers/{providerID}/payout-verifications → 200 `Provider`
 *
 * Body is `PayoutProof` — **two** signatures over the same challenge message:
 * the new payout wallet's, proving control of the destination, and the
 * authenticated owner wallet's, proving the request came from the account
 * holder. A stolen session alone therefore cannot redirect a provider's
 * earnings (docs/09-SECURITY.md §21-§23).
 *
 * Both pairs are passed through exactly as Nimiq Pay produced them.
 */
export function verifyPayoutWallet(
  providerId: string,
  input: {
    challengeId: string
    wallet: string
    publicKey: string
    signature: string
    ownerPublicKey: string
    ownerSignature: string
    /**
     * Which documented preprocessing produced both signatures, when the wallet
     * transport documents one. Both proofs come from the same transport in one
     * ceremony, so one value covers them; omitted, the backend verifies under
     * its configured default.
     */
    signingScheme?: SigningScheme | null
  },
  options: { signal?: AbortSignal } = {},
): Promise<Provider> {
  const { signingScheme, ...proof } = input
  return apiRequest<Provider>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/payout-verifications`,
    {
      method: 'POST',
      body: { ...proof, ...(signingScheme ? { signingScheme } : {}) },
      signal: options.signal,
    },
  )
}

/* -- Services ------------------------------------------------------------ */

/** GET /providers/{providerID}/services → `{ items: Service[] }`. */
export function listMyServices(
  providerId: string,
  signal?: AbortSignal,
): Promise<{ items: Service[] }> {
  return apiRequest<{ items: Service[] }>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/services`,
    { signal },
  )
}

/** GET /services/{serviceID} → `Service`. */
export function getMyService(id: string, signal?: AbortSignal): Promise<Service> {
  return apiRequest<Service>(`/api/v1/services/${encodeURIComponent(id)}`, { signal })
}

/**
 * POST /providers/{providerID}/services → 201 `Service` (DRAFT)
 *
 * Body is `ServiceInput`: `{ name, description?, category? }`. A new service
 * starts as a draft; publishing a pass later requires it to be ACTIVE.
 *
 * The category is the taxonomy value discovery filters on, and it lives on the
 * service — a pass inherits its service's category rather than carrying one.
 */
export function createService(
  providerId: string,
  input: { name: string; description?: string; category?: Category },
  options: { signal?: AbortSignal } = {},
): Promise<Service> {
  return apiRequest<Service>(`/api/v1/providers/${encodeURIComponent(providerId)}/services`, {
    method: 'POST',
    body: {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
    },
    signal: options.signal,
  })
}

/**
 * PATCH /services/{serviceID} → 200 `Service`
 *
 * Body is `ServiceUpdate`: `{ name, description?, status }`. A full replacement
 * of the editable fields, and `status` is required — the spec's transitions are
 * DRAFT→ACTIVE/ARCHIVED, ACTIVE→ARCHIVED, with ARCHIVED terminal.
 */
export function updateService(
  id: string,
  input: { name: string; description?: string; status: ServiceStatus; category?: Category },
  options: { signal?: AbortSignal } = {},
): Promise<Service> {
  return apiRequest<Service>(`/api/v1/services/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      // Sent whenever the caller decided one, `''` included: the form always
      // knows the category, and an omitted value would mean "keep whatever is
      // stored", which is not what an edited form is saying.
      ...(input.category !== undefined ? { category: input.category } : {}),
      status: input.status,
    },
    signal: options.signal,
  })
}

/* -- Passes ------------------------------------------------------------ */

export interface PassInput {
  title: string
  description?: string
  /** Whole sessions, minimum 1. */
  sessions: number
  /** Integer Luna. The spec forbids floating-point NIM on the wire. */
  priceLuna: number
  /** Optional fixed UTC expiry instant, or null for none. */
  expirationAt?: string | null
  /** Optional visual identity for pass details. */
  accent?: PassAccent | null
  /** Cover from POST /media, or null to clear. */
  coverMediaId?: string | null
}

/** GET /providers/{providerID}/passes → `{ items: Pass[] }`. */
export function listMyCatalogPasses(
  providerId: string,
  signal?: AbortSignal,
): Promise<{ items: Pass[] }> {
  return apiRequest<{ items: Pass[] }>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/passes`,
    { signal },
  )
}

/** GET /catalog/passes/{passID} → `Pass`. */
export function getMyCatalogPass(id: string, signal?: AbortSignal): Promise<Pass> {
  return apiRequest<Pass>(`/api/v1/catalog/passes/${encodeURIComponent(id)}`, { signal })
}

/** POST /providers/{providerID}/services/{serviceID}/passes → 201 `Pass` (DRAFT). */
export function createPass(
  providerId: string,
  serviceId: string,
  input: PassInput,
  options: { signal?: AbortSignal } = {},
): Promise<Pass> {
  return apiRequest<Pass>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/services/${encodeURIComponent(serviceId)}/passes`,
    { method: 'POST', body: passBody(input), signal: options.signal },
  )
}

/**
 * PATCH /catalog/passes/{passID} → 200 `Pass`
 *
 * Draft and unavailable passes only — the spec makes published passes
 * immutable, and a 409 says so. That is the pass-snapshot principle enforced
 * at the source: an edit must not be able to change what someone already bought
 * (docs/01-PRODUCT.md §19).
 */
export function updatePass(
  id: string,
  input: PassInput,
  options: { signal?: AbortSignal } = {},
): Promise<Pass> {
  return apiRequest<Pass>(`/api/v1/catalog/passes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: passBody(input),
    signal: options.signal,
  })
}

function passBody(input: PassInput) {
  return {
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    sessions: input.sessions,
    priceLuna: input.priceLuna,
    ...(input.expirationAt !== undefined ? { expirationAt: input.expirationAt } : {}),
    ...(input.accent !== undefined ? { accent: input.accent } : {}),
    ...(input.coverMediaId !== undefined ? { coverMediaId: input.coverMediaId } : {}),
  }
}

/**
 * POST /catalog/passes/{passID}/publish → 200 `Pass`
 *
 * The backend requires an active service, a valid pass and a *verified*
 * payout wallet, and answers 409 when any of those is missing. The workspace
 * explains those conditions, but this call is what decides
 * (docs/08-ARCHITECTURE.md §147).
 */
export function publishPass(
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<Pass> {
  return apiRequest<Pass>(`/api/v1/catalog/passes/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    signal: options.signal,
  })
}

/**
 * POST /catalog/passes/{passID}/unpublish → 200 `Pass` with `status: 'UNAVAILABLE'`
 *
 * Takes a Pass off the shelf without ending it. It leaves Discover, the
 * provider's public storefront and the provider directory's count, loses its
 * public page and stops accepting purchases — and keeps its id, its data and
 * its place in the owner's own catalogue, so `publishPass` puts it back
 * (docs/08-ARCHITECTURE.md §34, §136).
 *
 * Deliberately not `deletePass` with a flag. They are different acts with
 * different consequences, and the contract keeps them on different routes.
 *
 * Idempotent: a Pass that is already unpublished answers 200 unchanged, so a
 * repeated request is not an error the provider has to interpret.
 *
 * Authorisation is the backend's: a Pass this session does not own answers 404
 * (docs/09-SECURITY.md §33).
 */
export function unpublishPass(id: string, options: { signal?: AbortSignal } = {}): Promise<Pass> {
  return apiRequest<Pass>(`/api/v1/catalog/passes/${encodeURIComponent(id)}/unpublish`, {
    method: 'POST',
    signal: options.signal,
  })
}

/**
 * DELETE /catalog/passes/{passID} → 200 `Pass` with `status: 'ARCHIVED'`
 *
 * Deleting a Pass, as the provider means it: it stops being sellable, leaves
 * their catalogue and leaves Discover. The backend archives rather than removes
 * the row, because purchases, verified payments and already-purchased customer
 * passes reference it — so the response is the archived Pass rather than a 204,
 * and that is deliberate (docs/08-ARCHITECTURE.md §135-§136).
 *
 * Authorisation is the backend's: a Pass this session does not own answers 404,
 * whatever the caller renders (docs/09-SECURITY.md §33).
 */
export function deletePass(id: string, options: { signal?: AbortSignal } = {}): Promise<Pass> {
  return apiRequest<Pass>(`/api/v1/catalog/passes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: options.signal,
  })
}
