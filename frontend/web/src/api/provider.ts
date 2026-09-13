import type { AuthChallenge } from '@/types/auth'
import type { Package, Provider, Service, ServiceStatus } from '@/types/domain'

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
 * POST /providers → 201 `Provider`
 *
 * Body is `ProviderInput`: `{ name }`. This is the whole profile the contract
 * accepts today.
 */
export function createProvider(
  input: { name: string },
  options: { signal?: AbortSignal } = {},
): Promise<Provider> {
  return apiRequest<Provider>('/api/v1/providers', {
    method: 'POST',
    body: { name: input.name },
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
  input: { name: string },
  options: { signal?: AbortSignal } = {},
): Promise<Provider> {
  return apiRequest<Provider>(`/api/v1/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    body: { name: input.name },
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
  },
  options: { signal?: AbortSignal } = {},
): Promise<Provider> {
  return apiRequest<Provider>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/payout-verifications`,
    { method: 'POST', body: input, signal: options.signal },
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
 * Body is `ServiceInput`: `{ name, description? }`. A new service starts as a
 * draft; publishing a package later requires it to be ACTIVE.
 */
export function createService(
  providerId: string,
  input: { name: string; description?: string },
  options: { signal?: AbortSignal } = {},
): Promise<Service> {
  return apiRequest<Service>(`/api/v1/providers/${encodeURIComponent(providerId)}/services`, {
    method: 'POST',
    body: {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
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
  input: { name: string; description?: string; status: ServiceStatus },
  options: { signal?: AbortSignal } = {},
): Promise<Service> {
  return apiRequest<Service>(`/api/v1/services/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      status: input.status,
    },
    signal: options.signal,
  })
}

/* -- Packages ------------------------------------------------------------ */

export interface PackageInput {
  title: string
  description?: string
  /** Whole sessions, minimum 1. */
  sessions: number
  /** Integer Luna. The spec forbids floating-point NIM on the wire. */
  priceLuna: number
  /** Optional fixed UTC expiry instant, or null for none. */
  expirationAt?: string | null
}

/** GET /providers/{providerID}/packages → `{ items: Package[] }`. */
export function listMyPackages(
  providerId: string,
  signal?: AbortSignal,
): Promise<{ items: Package[] }> {
  return apiRequest<{ items: Package[] }>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/packages`,
    { signal },
  )
}

/** GET /packages/{packageID} → `Package`. */
export function getMyPackage(id: string, signal?: AbortSignal): Promise<Package> {
  return apiRequest<Package>(`/api/v1/packages/${encodeURIComponent(id)}`, { signal })
}

/** POST /providers/{providerID}/services/{serviceID}/packages → 201 `Package` (DRAFT). */
export function createPackage(
  providerId: string,
  serviceId: string,
  input: PackageInput,
  options: { signal?: AbortSignal } = {},
): Promise<Package> {
  return apiRequest<Package>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/services/${encodeURIComponent(serviceId)}/packages`,
    { method: 'POST', body: packageBody(input), signal: options.signal },
  )
}

/**
 * PATCH /packages/{packageID} → 200 `Package`
 *
 * Draft and unavailable packages only — the spec makes published packages
 * immutable, and a 409 says so. That is the package-snapshot principle enforced
 * at the source: an edit must not be able to change what someone already bought
 * (docs/01-PRODUCT.md §19).
 */
export function updatePackage(
  id: string,
  input: PackageInput,
  options: { signal?: AbortSignal } = {},
): Promise<Package> {
  return apiRequest<Package>(`/api/v1/packages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: packageBody(input),
    signal: options.signal,
  })
}

function packageBody(input: PackageInput) {
  return {
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    sessions: input.sessions,
    priceLuna: input.priceLuna,
    ...(input.expirationAt !== undefined ? { expirationAt: input.expirationAt } : {}),
  }
}

/**
 * POST /packages/{packageID}/publish → 200 `Package`
 *
 * The backend requires an active service, a valid package and a *verified*
 * payout wallet, and answers 409 when any of those is missing. The workspace
 * explains those conditions, but this call is what decides
 * (docs/08-ARCHITECTURE.md §147).
 */
export function publishPackage(
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<Package> {
  return apiRequest<Package>(`/api/v1/packages/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    signal: options.signal,
  })
}
