import type { Purchase } from '@/types/domain'

import { apiRequest } from './client'

/**
 * Purchase intents and payment settlement (`backend/openapi.yaml`,
 * `/purchases/*`).
 *
 * The shape of this module is the payment security model in miniature: the
 * client asks for a package, reports a hash, and asks for a re-check. It never
 * asserts an outcome. There is deliberately no endpoint that marks a purchase
 * paid (docs/08-ARCHITECTURE.md §63, docs/05 §34).
 */

/**
 * POST /purchases → 201 (new) or 200 (existing recoverable intent)
 *
 * Body is `CreatePurchase`: `{ packageId }`. Nothing else — the schema is
 * `additionalProperties: false`, and price, recipient, amount and payment
 * reference all come *back* from the backend (docs/08 §71, docs/05 §13-§14).
 * The authenticated wallet is the only customer identity, so no wallet is sent.
 *
 * 200 rather than 201 means an active unpaid intent for this wallet and package
 * already existed and was returned instead of a second one — recovery, built
 * into the contract.
 *
 * `Idempotency-Key` is bound to the customer; reusing one with a different
 * package is a 409 (docs/05 §68).
 */
export function createPurchaseIntent(
  input: { packageId: string },
  options: { idempotencyKey: string; signal?: AbortSignal },
): Promise<Purchase> {
  return apiRequest<Purchase>('/api/v1/purchases', {
    method: 'POST',
    body: { packageId: input.packageId },
    idempotencyKey: options.idempotencyKey,
    signal: options.signal,
  })
}

/**
 * GET /purchases → `{ items: Purchase[] }`
 *
 * Up to 100 newest own purchases. This is the recovery surface for a customer
 * who lost the purchase route entirely, and — until a pass list exists — the
 * only way to find the passes they own (docs/05 §129).
 */
export function listMyPurchases(signal?: AbortSignal): Promise<{ items: Purchase[] }> {
  return apiRequest<{ items: Purchase[] }>('/api/v1/purchases', { signal })
}

/** GET /purchases/{purchaseID} → `Purchase`. The authoritative payment state. */
export function getPurchase(id: string, signal?: AbortSignal): Promise<Purchase> {
  return apiRequest<Purchase>(`/api/v1/purchases/${encodeURIComponent(id)}`, { signal })
}

/**
 * POST /purchases/{purchaseID}/transactions → 202 `Purchase`
 *
 * Body is `TransactionSubmission`: `{ txHash }`, 64 hex characters.
 *
 * 202, not 200: the spec calls this a *candidate*. Submitting a hash claims no
 * ownership of it, proves no broadcast, and creates no pass
 * (docs/09-SECURITY.md §26, docs/05 §33-§35). Idempotent for the same hash; a
 * different candidate for the same purchase is a 409.
 */
export function submitTransaction(
  id: string,
  input: { txHash: string },
  options: { signal?: AbortSignal } = {},
): Promise<Purchase> {
  return apiRequest<Purchase>(`/api/v1/purchases/${encodeURIComponent(id)}/transactions`, {
    method: 'POST',
    body: { txHash: input.txHash },
    signal: options.signal,
  })
}

/**
 * POST /purchases/{purchaseID}/reconcile → 200 `Purchase`
 *
 * Asks the backend to re-check the candidate transaction and macro-block
 * finality. Safe to retry by design: the spec states that not-found and RPC
 * outages stay *uncertain* and never authorise a second payment
 * (docs/05 §62-§63, §95-§97).
 *
 * This requests a re-check; it never asserts an outcome.
 */
export function reconcilePurchase(
  id: string,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<Purchase> {
  return apiRequest<Purchase>(`/api/v1/purchases/${encodeURIComponent(id)}/reconcile`, {
    method: 'POST',
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    signal: options.signal,
  })
}

/**
 * POST /purchases/{purchaseID}/cancel → 200 `Purchase`
 *
 * Only an unpaid, unsubmitted intent can be cancelled; anything past that is a
 * 409. Cancelling is about abandoning an intent, never about undoing a payment.
 */
export function cancelPurchase(
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<Purchase> {
  return apiRequest<Purchase>(`/api/v1/purchases/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    signal: options.signal,
  })
}
