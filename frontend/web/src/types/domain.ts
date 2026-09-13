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
 * NOT IN THE CONTRACT YET. `backend/openapi.yaml` defines no redemption
 * endpoints and `GET /passes/{passID}` is explicitly documented as "no
 * redemption in Mission 03". These shapes describe what the redemption UI
 * already renders; they are the boundary Mission 04 will fill in, and nothing
 * in the app treats them as available (docs/09-SECURITY.md §43-§44).
 * -------------------------------------------------------------------- */

export type RedemptionStatus = 'CREATED' | 'AUTHORIZED' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED'

export interface RedemptionChallenge {
  id: string
  passId: string
  /** The only thing that goes into a QR code (docs/09-SECURITY.md §45). */
  reference: string
  status: RedemptionStatus
  expiresAt: string
  requiresWalletSignature: boolean
  /** Server-built message to sign when required. Never composed client-side. */
  signingMessage: string | null
}

export interface Redemption {
  id: string
  passId: string
  status: RedemptionStatus
  completedAt: string | null
  /** Authoritative post-redemption balance, as returned by the backend. */
  remainingSessions: number
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
