import type {
  Compensation,
  Pass,
  Purchase,
  RedemptionChallenge,
  RedemptionConfirmation,
  RedemptionHistoryItem,
  RedemptionLookup,
} from '@/types/domain'

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
  compensation: null,
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

/**
 * The compensation case, exactly as `Compensation` in the spec shapes it.
 *
 * Note where `doNotPayAgain` and `automatedRefund` live: nested, not on the
 * purchase root. A fixture that flattened them would let a frontend bug — the
 * one where `purchase.doNotPayAgain` reads `undefined` and the UI helpfully
 * offers to pay again — pass every test.
 */
export function aCompensation(overrides: Partial<Compensation> = {}): Compensation {
  return {
    status: 'OPEN',
    reason: 'PACKAGE_EXPIRED_BEFORE_ACTIVATION',
    createdAt: '2026-09-13T10:40:00Z',
    message:
      'Payment received, but this package expired before the pass could be activated. Do not pay again.',
    doNotPayAgain: true,
    automatedRefund: false,
    ...overrides,
  }
}

/**
 * A purchase whose payment was verified and finalised, but which produced no
 * pass — the path §2-§7 of Milestone 4A exist for.
 *
 * `passId` stays null and `paymentRequest` stays null on purpose: there is
 * nothing to show and nothing left to pay.
 */
export function aCompensationPurchase(overrides: Partial<Purchase> = {}): Purchase {
  return aPurchase({
    status: 'compensation_required',
    purchaseStatus: 'COMPENSATION_REQUIRED',
    paymentVerification: 'COMPENSATION_REQUIRED',
    transactionHash: 'a1b2c3d4'.repeat(8),
    broadcastObservedAt: '2026-09-13T10:20:00Z',
    paymentRequest: null,
    passId: null,
    compensation: aCompensation(),
    ...overrides,
  })
}

/* -- Redemption ----------------------------------------------------------
 *
 * Shaped exactly as `backend/openapi.yaml` shapes them. The one detail worth
 * naming: `redemptionReference` defaults to null, because that is what reading
 * a challenge back actually returns. Only the authorization and rotation
 * builders below carry one — a fixture that handed out references freely would
 * let a bug that shows an unauthorised QR pass every test.
 * -------------------------------------------------------------------- */

const CHALLENGE_ID = '50000000-0000-4000-8000-000000000001'

/** A canonical message shaped like the backend's, for signature pass-through. */
export const CANONICAL_REDEMPTION_MESSAGE = [
  'NIMPASS',
  'Version: 1',
  'Purpose: AUTHORIZE_REDEMPTION',
  `Challenge: ${CHALLENGE_ID}`,
  'Pass: 40000000-0000-4000-8000-000000000001',
  'Provider: 00000000-0000-4000-8000-000000000002',
  'Wallet: NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
  'Network: TESTNET',
  'Environment: test',
  'Nonce: 60000000-0000-4000-8000-000000000001',
  'Issued-At: 2026-09-14T10:00:00Z',
  'Expires-At: 2026-09-14T10:05:00Z',
  'Expected-Used-Sessions: 3',
  'Expected-Remaining-Sessions: 7',
].join('\n')

export const A_REFERENCE = `NR1:${'ab12cd34'.repeat(8)}`

export function aRedemptionChallenge(
  overrides: Partial<RedemptionChallenge> = {},
): RedemptionChallenge {
  return {
    challengeId: CHALLENGE_ID,
    passId: '40000000-0000-4000-8000-000000000001',
    providerId: '00000000-0000-4000-8000-000000000002',
    purpose: 'AUTHORIZE_REDEMPTION',
    status: 'CREATED',
    message: CANONICAL_REDEMPTION_MESSAGE,
    createdAt: '2026-09-14T10:00:00Z',
    // Far future so a local countdown does not expire mid-test.
    expiresAt: '2099-01-01T00:00:00Z',
    authorizedAt: null,
    consumedAt: null,
    pass: {
      status: 'ACTIVE',
      originalSessions: 10,
      usedSessions: 3,
      remainingSessions: 7,
      expiresAt: null,
    },
    redemption: null,
    redemptionReference: null,
    qrExpiresAt: null,
    ...overrides,
  }
}

/** What the authorization endpoint returns: authorised, *with* a reference. */
export function anAuthorizedChallenge(
  overrides: Partial<RedemptionChallenge> = {},
): RedemptionChallenge {
  return aRedemptionChallenge({
    status: 'AUTHORIZED',
    authorizedAt: '2026-09-14T10:01:00Z',
    redemptionReference: A_REFERENCE,
    qrExpiresAt: '2099-01-01T00:00:00Z',
    ...overrides,
  })
}

export function aRedemptionLookup(overrides: Partial<RedemptionLookup> = {}): RedemptionLookup {
  return {
    challengeId: CHALLENGE_ID,
    passId: '40000000-0000-4000-8000-000000000001',
    providerId: '00000000-0000-4000-8000-000000000002',
    serviceName: 'Personal Training',
    packageTitle: '10 Personal Training Sessions',
    challengeStatus: 'AUTHORIZED',
    authorizationStatus: 'AUTHORIZED',
    passStatus: 'ACTIVE',
    usedSessions: 3,
    remainingSessions: 7,
    nextSessionOrdinal: 4,
    passExpiresAt: null,
    challengeExpiresAt: '2099-01-01T00:00:00Z',
    referenceExpiresAt: '2099-01-01T00:00:00Z',
    ...overrides,
  }
}

export function aRedemptionConfirmation(
  overrides: Partial<RedemptionConfirmation> = {},
): RedemptionConfirmation {
  return {
    redemptionId: '70000000-0000-4000-8000-000000000001',
    passId: '40000000-0000-4000-8000-000000000001',
    redeemedAt: '2026-09-14T10:02:00Z',
    usedSessions: 4,
    remainingSessions: 6,
    passStatus: 'ACTIVE',
    completed: false,
    ...overrides,
  }
}

export function aRedemptionHistoryItem(
  overrides: Partial<RedemptionHistoryItem> = {},
): RedemptionHistoryItem {
  return {
    redemptionId: '70000000-0000-4000-8000-000000000001',
    challengeId: CHALLENGE_ID,
    passId: '40000000-0000-4000-8000-000000000001',
    providerId: '00000000-0000-4000-8000-000000000002',
    serviceId: '00000000-0000-4000-8000-000000000003',
    packageId: '00000000-0000-4000-8000-000000000004',
    sessionOrdinal: 1,
    ownerWallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
    redeemedAt: '2026-08-10T09:00:00Z',
    status: 'CONSUMED',
    ...overrides,
  }
}
