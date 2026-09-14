/**
 * The Nimpass domain, as `backend/openapi.yaml` defines it.
 *
 * These are wire types, not a second model. Field names, nullability and enum
 * spellings are copied from the spec's schemas — `Provider`, `Service`,
 * `Package`, `PublicOffer`, `Purchase`, `Pass` — so a response can be used
 * directly and a mismatch shows up as a type error rather than as `undefined`
 * on screen.
 *
 * Nothing here enforces a business rule. The frontend renders what the backend
 * reports and never derives an authoritative value from it
 * (docs/08-ARCHITECTURE.md §11, §70; docs/09-SECURITY.md §6).
 *
 * Money is always integer Luna (1 NIM = 100,000 Luna), matching the spec's
 * `priceLuna`/`valueLuna` and the Nimiq provider's `value` parameter.
 * Ref: https://nimiq.dev/mini-apps/api-reference/nimiq-provider
 */

/** Integer Luna. Never a float, never a NIM-denominated decimal. */
export type Luna = number

/**
 * Nimiq network, spelled as the spec spells it.
 * A testnet transaction is never a mainnet purchase (docs/04 §49).
 */
export type NimiqNetwork = 'MAINNET' | 'TESTNET'

/* -- Provider ------------------------------------------------------------ */

/**
 * A provider as its owner sees it (`Provider`).
 *
 * The whole profile is `name` plus payout state. There is no slug, headline,
 * bio, avatar, cover image or service count in the contract — see
 * `docs`-vs-contract gaps in the Milestone 3.6 report. The UI shows what exists
 * rather than inventing the rest (docs/08-ARCHITECTURE.md §11).
 */
export interface Provider {
  id: string
  name: string
  /** The payout address, once one has been proposed. */
  payoutWallet: string | null
  /**
   * When the payout wallet passed server-side signature verification
   * (docs/09-SECURITY.md §21). Null means unverified — and an unverified
   * provider cannot publish.
   */
  payoutVerifiedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Convenience: the backend's rule, read from the record it returns. */
export function isPayoutVerified(provider: Pick<Provider, 'payoutVerifiedAt'>): boolean {
  return provider.payoutVerifiedAt !== null
}

/** A provider as the public sees it (`PublicProvider`): identity only. */
export interface PublicProvider {
  id: string
  name: string
}

/* -- Service ------------------------------------------------------------- */

/** `Service.status`. ARCHIVED is terminal. */
export type ServiceStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'

export interface Service {
  id: string
  providerId: string
  name: string
  description: string
  status: ServiceStatus
  createdAt: string
  updatedAt: string
}

/** A service as the public sees it (`PublicService`). */
export interface PublicService {
  id: string
  name: string
  description: string
}

/* -- Package ------------------------------------------------------------- */

/** `Package.status`. */
export type PackageStatus = 'DRAFT' | 'ACTIVE' | 'UNAVAILABLE' | 'ARCHIVED'

export interface Package {
  id: string
  providerId: string
  serviceId: string
  title: string
  description: string
  /** Whole sessions, minimum 1 (docs/08-ARCHITECTURE.md §76). */
  sessions: number
  priceLuna: Luna
  currency: 'NIM'
  /** Optional fixed UTC expiry. The contract has no relative duration. */
  expirationAt: string | null
  status: PackageStatus
  createdAt: string
  updatedAt: string
}

/**
 * A published package with the provider and service it belongs to
 * (`PublicOffer`). This is the only shape public discovery returns.
 */
export interface PublicOffer {
  package: Package
  provider: PublicProvider
  service: PublicService
}

/* -- Purchase ------------------------------------------------------------ */

/**
 * The server-authored payment instruction (`PaymentRequest`).
 *
 * Every field is passed to Nimiq Pay unchanged. `data` in particular is an
 * exact UTF-8 string the backend correlates the on-chain transaction with; the
 * spec says not to regenerate it, and the frontend does not
 * (docs/05-NIMIQ-PAY-INTEGRATION.md §24-§28).
 */
export interface PaymentRequest {
  recipient: string
  /** Exact business amount in Luna. The network fee is separate. */
  valueLuna: Luna
  /** `NP1:` + 32 hex characters. */
  data: string
  network: NimiqNetwork
  expiresAt: string
}

/**
 * The customer-facing payment lifecycle (`Purchase.status`).
 *
 * Deliberately finer-grained than `purchaseStatus`: it separates outcomes the
 * record alone cannot express, notably `uncertain_retryable` — the state that
 * exists so a lost answer is never reported as a failure
 * (docs/05 §62).
 */
export type PurchaseUiStatus =
  | 'awaiting_payment'
  | 'transaction_submitted'
  | 'verifying'
  | 'awaiting_finality'
  | 'uncertain_retryable'
  | 'confirmed'
  | 'pass_provisioning'
  | 'completed'
  | 'compensation_required'
  | 'cancelled'
  | 'expired'
  | 'permanently_failed'

/** The stored record's own status (`Purchase.purchaseStatus`). */
export type PurchaseRecordStatus =
  | 'CREATED'
  | 'PAYMENT_PENDING'
  | 'TRANSACTION_SUBMITTED'
  | 'VERIFYING'
  | 'AWAITING_FINALITY'
  | 'CONFIRMED'
  | 'COMPENSATION_REQUIRED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'

/** How far the backend has got verifying the candidate transaction. */
export type PaymentVerification =
  | 'SUBMITTED'
  | 'NOT_FOUND'
  | 'UNCERTAIN'
  | 'INCLUDED'
  | 'AWAITING_FINALITY'
  | 'MISMATCH'
  | 'COMPENSATION_REQUIRED'

/**
 * The compensation case (`Compensation`).
 *
 * This is the contract's answer to a genuinely awkward outcome: the payment was
 * verified and macro-finalised on chain, but the package's fixed expiration
 * passed before a pass could be activated, so the backend committed the receipt
 * and opened a compensation case instead of issuing an entitlement.
 *
 * Two of these fields are safety flags rather than data, and the spec pins both
 * to a single value (`doNotPayAgain: true`, `automatedRefund: false`). They are
 * still read from the wire rather than assumed, but nothing in the UI may
 * reverse their meaning: there is no backend wallet custody and no automatic
 * refund, so the frontend must never suggest money is on its way back.
 */
export interface Compensation {
  /** `OPEN` until a human resolves it. Not a payment status. */
  status: 'OPEN' | 'RESOLVED'
  reason: 'PACKAGE_EXPIRED_BEFORE_ACTIVATION'
  createdAt: string
  /** The backend's own explanation. Rendered as supporting detail, not as the headline. */
  message: string
  /** Always true. The one flag that must never be inverted by a client default. */
  doNotPayAgain: boolean
  /** Always false. Refund and reissue are manual, between customer and provider. */
  automatedRefund: boolean
}

/**
 * A purchase intent and its authoritative payment state (`Purchase`).
 *
 * A purchase is the payment's lifecycle — a different state machine from the
 * pass it may eventually produce (docs/08 §41, docs/05 §53). Commercial terms
 * are snapshotted at intent creation, so later package edits cannot move them.
 */
export interface Purchase {
  purchaseIntentId: string
  status: PurchaseUiStatus
  purchaseStatus: PurchaseRecordStatus
  packageId: string
  packageTitle: string
  serviceId: string
  providerId: string
  sessions: number
  priceLuna: Luna
  customerWallet: string
  createdAt: string
  expiresAt: string
  transactionHash: string | null
  /** Set only when the backend saw the transaction in the mempool before expiry. */
  broadcastObservedAt: string | null
  paymentVerification: PaymentVerification | null
  failureCategory: string | null
  /** Present once this purchase produced a pass. */
  passId: string | null
  /** Present only while the intent is still awaiting payment. */
  paymentRequest: PaymentRequest | null
  /**
   * Present only in `COMPENSATION_REQUIRED`. A verified payment with no pass.
   *
   * Note the shape: `doNotPayAgain` and `automatedRefund` live *here*, not on
   * the purchase root. Reading them off `Purchase` returns `undefined`, which
   * is falsy — and a falsy `doNotPayAgain` is the exact inversion of the
   * guarantee it encodes.
   */
  compensation: Compensation | null
}

/* -- Pass ---------------------------------------------------------------- */

/** `Pass.status`. A pass only exists once a payment was verified and finalised. */
export type PassStatus = 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED'

/**
 * A pass: the customer's purchased entitlement.
 *
 * `usedSessions + remainingSessions === originalSessions` is an invariant the
 * *backend* guarantees; the frontend renders these numbers and never recomputes
 * them after a redemption (docs/08-ARCHITECTURE.md §37, §49).
 */
export interface Pass {
  id: string
  purchaseId: string
  ownerWallet: string
  /** Terms frozen at purchase time, so a later package edit cannot change them. */
  packageId: string
  packageTitle: string
  serviceId: string
  providerId: string
  originalSessions: number
  usedSessions: number
  remainingSessions: number
  status: PassStatus
  createdAt: string
  expiresAt: string | null
}

/* -- Redemption ----------------------------------------------------------
 *
 * The shapes `backend/openapi.yaml` defines, as Mission 04.1 canonicalised
 * them. The speculative versions this block used to hold are gone.
 *
 * The flow these types describe is the security model, so it is worth stating
 * plainly: a challenge is created, the *pass owner* signs the server's exact
 * canonical message, and only that authorisation produces a short-lived NR1
 * bearer reference. The signature is mandatory — there is no field anywhere
 * that makes it optional, and no path to a usable reference without one.
 * -------------------------------------------------------------------- */

/** `RedemptionChallenge.status`. */
export type RedemptionStatus = 'CREATED' | 'AUTHORIZED' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED'

/** The only signing purpose redemption uses. Server-authored, never composed here. */
export type RedemptionPurpose = 'AUTHORIZE_REDEMPTION'

/** The pass counters carried inside a challenge response. */
export interface RedemptionChallengePass {
  status: PassStatus
  originalSessions: number
  usedSessions: number
  remainingSessions: number
  expiresAt: string | null
}

/** Set once the challenge has been consumed by a provider. */
export interface RedemptionChallengeRedemption {
  id: string
  sessionOrdinal: number
  redeemedAt: string
}

/**
 * A redemption challenge (`RedemptionChallenge`).
 *
 * `message` is the exact UTF-8 string to hand to Nimiq Pay's `sign()`. It
 * already carries its own domain separation (`Purpose: AUTHORIZE_REDEMPTION`),
 * the challenge and pass ids, the wallet, the network, a nonce and the expected
 * session counters. Reconstructing, trimming or prefixing any of it produces a
 * signature over different bytes, which the backend will reject — correctly.
 *
 * `redemptionReference` is deliberately nullable and deliberately rare: the
 * contract returns it **only** from the authorization response and from a
 * challenge rotation. Reading a challenge back — `GET .../current` or
 * `GET /redemption-challenges/{id}` — never includes it.
 */
export interface RedemptionChallenge {
  challengeId: string
  passId: string
  providerId: string
  purpose: RedemptionPurpose
  status: RedemptionStatus
  /** Sign this exact string. Never rebuild it. */
  message: string
  createdAt: string
  expiresAt: string
  authorizedAt: string | null
  consumedAt: string | null
  pass: RedemptionChallengePass
  redemption: RedemptionChallengeRedemption | null
  /** `NR1:` + 64 lowercase hex. Present only after authorisation or rotation. */
  redemptionReference: string | null
  qrExpiresAt: string | null
}

/**
 * What a provider may see before consuming anything (`RedemptionLookup`).
 *
 * Privacy-minimised on purpose: enough to know which service, which package and
 * which session is about to be used, and nothing identifying the customer. No
 * wallet, no email, no identity id. The narrowness is the feature
 * (docs/09-SECURITY.md §38, §92).
 *
 * Note the enums: the backend only ever returns this shape for a challenge that
 * is `AUTHORIZED` against an `ACTIVE` pass. Anything else is an error response,
 * not a lookup with a different status — so these are single-member unions
 * rather than the full status sets.
 */
export interface RedemptionLookup {
  challengeId: string
  passId: string
  providerId: string
  serviceName: string
  packageTitle: string
  challengeStatus: 'AUTHORIZED'
  authorizationStatus: 'AUTHORIZED'
  passStatus: 'ACTIVE'
  usedSessions: number
  remainingSessions: number
  /** Which session this confirmation would consume. 1-based. */
  nextSessionOrdinal: number
  passExpiresAt: string | null
  challengeExpiresAt: string
  referenceExpiresAt: string | null
}

/**
 * The authoritative result of consuming one session
 * (`RedemptionConfirmationResult`).
 *
 * Every number here is the backend's. The frontend does not compute
 * `remaining - 1` anywhere — it reads these and refetches
 * (docs/08-ARCHITECTURE.md §49).
 */
export interface RedemptionConfirmation {
  redemptionId: string
  passId: string
  redeemedAt: string
  usedSessions: number
  remainingSessions: number
  passStatus: PassStatus
  /** True when this consumption took the pass to zero remaining. */
  completed: boolean
}

/** One consumed session (`RedemptionHistoryItem`). Only consumed rows exist. */
export interface RedemptionHistoryItem {
  redemptionId: string
  challengeId: string
  passId: string
  providerId: string
  serviceId: string
  packageId: string
  /** 1-based position in this pass's session sequence. */
  sessionOrdinal: number
  ownerWallet: string
  redeemedAt: string
  status: 'CONSUMED'
}

/**
 * A published package flattened with its provider and service.
 *
 * `PublicOffer` nests three objects, which is awkward to render; this is the
 * same data with one level removed. It is a view of the response, not a richer
 * model — every field comes from the wire, and the fields the contract does not
 * have (image, category, provider avatar or bio) are simply absent rather than
 * defaulted.
 */
export interface PackageListing extends Package {
  provider: PublicProvider
  service: PublicService
}

export function toPackageListing(offer: PublicOffer): PackageListing {
  return { ...offer.package, provider: offer.provider, service: offer.service }
}
