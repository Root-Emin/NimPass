import type { Pass, Purchase } from '@/types/domain'

/**
 * Wire-accurate test data.
 *
 * Every field, name and enum spelling comes from `backend/openapi.yaml`, so a
 * test built on these is asserting against the contract the backend actually
 * serves — not a shape that only exists in the frontend.
 */

export function aPurchase(overrides: Partial<Purchase> = {}): Purchase {
  return { ...({
  purchaseIntentId: 'aaaaaaaa-0000-4000-8000-000000000001',
  status: 'awaiting_payment',
  purchaseStatus: 'CREATED',
  packageId: '00000000-0000-4000-8000-000000000004',
  packageTitle: '10 Personal Training Sessions',
  serviceId: '00000000-0000-4000-8000-000000000003',
  providerId: '00000000-0000-4000-8000-000000000002',
  sessions: 10,
  priceLuna: 25_000_000,
  customerWallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
  createdAt: '2026-09-13T10:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z',
  transactionHash: null,
  broadcastObservedAt: null,
  paymentVerification: null,
  failureCategory: null,
  passId: null,
  paymentRequest: {
    recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    valueLuna: 25_000_000,
    data: 'NP1:0123456789abcdef0123456789abcdef',
    network: 'TESTNET',
    expiresAt: '2099-01-01T00:00:00Z',
  },
} as Purchase), ...overrides }
}

export function aPass(overrides: Partial<Pass> = {}): Pass {
  return { ...({
  id: '40000000-0000-4000-8000-000000000001',
  purchaseId: 'aaaaaaaa-0000-4000-8000-000000000001',
  ownerWallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
  packageId: '00000000-0000-4000-8000-000000000004',
  packageTitle: '10 Personal Training Sessions',
  serviceId: '00000000-0000-4000-8000-000000000003',
  providerId: '00000000-0000-4000-8000-000000000002',
  originalSessions: 10,
  usedSessions: 3,
  remainingSessions: 7,
  status: 'ACTIVE',
  createdAt: '2026-08-01T10:00:00Z',
  expiresAt: null,
} as Pass), ...overrides }
}
