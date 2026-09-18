import type {
  Compensation,
  PassSession,
  PassSessionList,
  PurchasedPass,
  PurchasedPassPage,
  Purchase,
  RedemptionChallenge,
  RedemptionHistoryItem,
  Settlement,
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
  passId: '00000000-0000-4000-8000-000000000004',
  passTitle: '10 Personal Training Sessions',
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
  purchasedPassId: null,
  compensation: null,
  settlement: null,
  paymentRequest: {
    recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    valueLuna: 25_000_000,
    // 25,000,000 Luna is 250 NIM. Both are stated because the payment link
    // carries decimal NIM while settlement compares integer Luna.
    valueNim: '250',
    data: 'NP1:0123456789abcdef0123456789abcdef',
    network: 'TESTNET',
    expiresAt: '2099-01-01T00:00:00Z',
    uri: 'nimiq:NQ0700000000000000000000000000000000?amount=250&message=NP1%3A0123456789abcdef0123456789abcdef',
  },
} as Purchase), ...overrides }
}

export function aPurchasedPass(overrides: Partial<PurchasedPass> = {}): PurchasedPass {
  return { ...({
  id: '40000000-0000-4000-8000-000000000001',
  purchaseId: 'aaaaaaaa-0000-4000-8000-000000000001',
  ownerWallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
  passId: '00000000-0000-4000-8000-000000000004',
  passTitle: '10 Personal Training Sessions',
  serviceId: '00000000-0000-4000-8000-000000000003',
  providerId: '00000000-0000-4000-8000-000000000002',
  serviceName: 'Personal Training',
  providerName: 'Alex Fitness',
  priceLuna: 25_000_000,
  originalSessions: 10,
  usedSessions: 3,
  remainingSessions: 7,
  status: 'ACTIVE',
  createdAt: '2026-08-01T10:00:00Z',
  expiresAt: null,
  completedAt: null,
  viewerRole: 'OWNER',
} as PurchasedPass), ...overrides }
}

/**
 * One session record of a purchased pass.
 *
 * Defaults to an open, undated session — the state most of a fresh pass is in
 * and the one a test has to opt *out* of, not into.
 */
export function aPassSession(overrides: Partial<PassSession> = {}): PassSession {
  return {
    id: '50000000-0000-4000-8000-000000000001',
    passId: '40000000-0000-4000-8000-000000000001',
    sequenceNumber: 1,
    status: 'UNSCHEDULED',
    scheduledAt: null,
    completedAt: null,
    completedBy: null,
    redemptionId: null,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    ...overrides,
  }
}

/**
 * A pass's whole session list, as `GET /passes/{passID}/sessions` sends it.
 *
 * The counters are derived from the rows here rather than passed in
 * separately, because the backend writes them in one transaction and a
 * fixture that let them disagree would let a bug in the screen pass.
 */
export function aPassSessionList(
  sessions: PassSession[],
  overrides: Partial<PassSessionList> = {},
): PassSessionList {
  const pass = aPurchasedPass({
    originalSessions: sessions.length,
    usedSessions: sessions.filter((s) => s.status === 'COMPLETED').length,
    remainingSessions: sessions.filter((s) => s.status !== 'COMPLETED').length,
    ...(overrides.pass ?? {}),
  })
  return {
    passId: pass.id,
    role: 'OWNER',
    pass,
    items: sessions,
    totalSessions: pass.originalSessions,
    completedSessions: pass.usedSessions,
    remainingSessions: pass.remainingSessions,
    ...overrides,
  }
}

/** A pass's sessions: `completed` of `total` done, the rest open. */
export function passSessions(total: number, completed = 0): PassSession[] {
  return Array.from({ length: total }, (_, index) =>
    aPassSession({
      id: `50000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, '0')}`,
      sequenceNumber: index + 1,
      status: index < completed ? 'COMPLETED' : 'UNSCHEDULED',
      completedAt: index < completed ? '2026-08-10T09:00:00Z' : null,
      completedBy: index < completed ? 'OWNER' : null,
    }),
  )
}

/**
 * One page of `GET /passes`.
 *
 * `nextCursor` defaults to null — the end of the collection — so a test only
 * says otherwise when paging is what it is testing.
 */
export function aPurchasedPassPage(items: PurchasedPass[], nextCursor: string | null = null): PurchasedPassPage {
  return { items, nextCursor }
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
    reason: 'PASS_EXPIRED_BEFORE_ACTIVATION',
    createdAt: '2026-09-13T10:40:00Z',
    message:
      'Payment received, but this pass expired before the pass could be activated. Do not pay again.',
    doNotPayAgain: true,
    automatedRefund: false,
    ...overrides,
  }
}

/**
 * A purchase whose payment was verified and finalised, but which produced no
 * pass — the path §2-§7 of Milestone 4A exist for.
 *
 * `purchasedPassId` stays null and `paymentRequest` stays null on purpose: there is
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
    purchasedPassId: null,
    compensation: aCompensation(),
    settlement: aSettlement({ status: 'FINALIZED' }),
    ...overrides,
  })
}

/**
 * The settlement behind an accepted payment, as `Settlement` shapes it.
 *
 * Defaults to `INCLUDED` — provisional — because under
 * `NIMIQ_CONFIRMATION_POLICY=inclusion` that is what a freshly completed
 * purchase carries for the first minute or so of its life (ADR-021). A fixture
 * defaulting to `FINALIZED` would make the normal case the one no test covers.
 *
 * `finalityBlock` and `finalizedAt` are null here and non-null under
 * `FINALIZED`, mirroring the columns the backend actually leaves empty until a
 * macro block is observed.
 */
export function aSettlement(overrides: Partial<Settlement> = {}): Settlement {
  const finalized = overrides.status === 'FINALIZED'
  return {
    status: 'INCLUDED',
    provisional: !finalized,
    inclusionBlock: 1_000,
    includedAt: '2026-09-13T10:20:01Z',
    expectedFinalityBlock: 1_060,
    finalityBlock: finalized ? 1_060 : null,
    finalizedAt: finalized ? '2026-09-13T10:21:00Z' : null,
    contestedAt: null,
    contestReason: null,
    ...overrides,
  }
}

/**
 * A completed purchase with its pass issued on a still-provisional payment.
 *
 * The fast-checkout outcome: `completed`, a pass to open, and a settlement the
 * finality worker has not promoted yet. Nothing about the customer's view may
 * depend on that difference (ADR-021), which is precisely why a fixture for it
 * exists.
 */
export function aProvisionalPurchase(overrides: Partial<Purchase> = {}): Purchase {
  return aPurchase({
    status: 'completed',
    purchaseStatus: 'CONFIRMED',
    paymentVerification: 'CONFIRMED',
    transactionHash: 'a1b2c3d4'.repeat(8),
    broadcastObservedAt: '2026-09-13T10:20:00Z',
    paymentRequest: null,
    purchasedPassId: '40000000-0000-4000-8000-000000000001',
    settlement: aSettlement(),
    ...overrides,
  })
}

/**
 * The reversed-settlement case: a pass issued on an inclusion that never became
 * canonical.
 *
 * Distinct from `aCompensationPurchase` in the one way that matters to the
 * customer — `doNotPayAgain` is false, because no NIM ever left their wallet.
 */
export function aReversedSettlementPurchase(overrides: Partial<Purchase> = {}): Purchase {
  return aCompensationPurchase({
    compensation: aCompensation({
      reason: 'PAYMENT_SETTLEMENT_REVERSED',
      message:
        'The payment behind this purchase did not stay on the canonical chain. Nothing was charged.',
      doNotPayAgain: false,
    }),
    settlement: aSettlement({
      status: 'CONTESTED',
      provisional: false,
      contestedAt: '2026-09-13T10:22:00Z',
      contestReason: 'SETTLEMENT_REVERSED',
    }),
    ...overrides,
  })
}

/* -- Redemption ----------------------------------------------------------
 *
 * Shaped exactly as `backend/openapi.yaml` shapes them. A challenge is only
 * ever CREATED or CONSUMED in practice: authorizing spends the session in the
 * same transaction, so `aConsumedChallenge` is what the authorization endpoint
 * actually returns.
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
    ...overrides,
  }
}

/**
 * What the authorization endpoint returns: consumed, with the session already
 * spent and the resulting counts on the pass snapshot.
 */
export function aConsumedChallenge(
  overrides: Partial<RedemptionChallenge> = {},
): RedemptionChallenge {
  return aRedemptionChallenge({
    status: 'CONSUMED',
    authorizedAt: '2026-09-14T10:01:00Z',
    consumedAt: '2026-09-14T10:01:00Z',
    pass: {
      status: 'ACTIVE',
      originalSessions: 10,
      usedSessions: 4,
      remainingSessions: 6,
      expiresAt: null,
    },
    redemption: {
      id: '70000000-0000-4000-8000-000000000001',
      sessionOrdinal: 4,
      redeemedAt: '2026-09-14T10:01:00Z',
    },
    ...overrides,
  })
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
    sourcePassId: '00000000-0000-4000-8000-000000000004',
    sessionOrdinal: 1,
    ownerWallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
    redeemedAt: '2026-08-10T09:00:00Z',
    status: 'CONSUMED',
    ...overrides,
  }
}
