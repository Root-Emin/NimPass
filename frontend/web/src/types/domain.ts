/**
 * The Nimpass domain, as `backend/openapi.yaml` defines it.
 *
 * These are wire types, not a second model. Field names, nullability and enum
 * spellings are copied from the spec's schemas — `Provider`, `Service`,
 * `Pass`, `PublicPass`, `Purchase`, `PurchasedPass` — so a response can be used
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

/**
 * The controlled service taxonomy (`Category`).
 *
 * The empty string is the contract's "unclassified" value, not a missing one:
 * a service may legitimately have no category, and the spec spells that as `''`
 * rather than null. `GET /public/categories` returns the same list without it.
 */
export type Category =
  | ''
  | 'fitness'
  | 'tutoring'
  | 'languages'
  | 'coaching'
  | 'wellness'
  | 'music'
  | 'beauty'
  | 'consulting'
  | 'mentoring'

/** Every classified value, in the order the contract lists them. */
export const CATEGORIES = [
  'fitness',
  'tutoring',
  'languages',
  'coaching',
  'wellness',
  'music',
  'beauty',
  'consulting',
  'mentoring',
] as const satisfies readonly Exclude<Category, ''>[]

export type ClassifiedCategory = (typeof CATEGORIES)[number]

/* -- Provider ------------------------------------------------------------ */

/**
 * A provider as its owner sees it (`Provider`).
 *
 * Profile text is plain text the provider typed, and `avatarUrl` is an external
 * HTTPS reference the backend stores but never fetches — so it is rendered as a
 * remote image and nothing more. Empty strings are the contract's "not set":
 * the optional fields are required in the response and non-nullable, so absence
 * is `''`, never `undefined`.
 *
 * `slug` is assigned once at creation and never changes, including when the
 * display name does — which is what makes a shared provider URL stable.
 */
export interface Provider {
  id: string
  name: string
  slug: string
  headline: string
  bio: string
  /** External HTTPS URL, or `''`. The backend neither fetches nor hosts it. */
  avatarUrl: string
  /** Which Nimiq identicon of the owner wallet is shown. 0 is the wallet's own. */
  avatarVariant: number
  location: string
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

/**
 * A provider as the public sees it (`PublicProvider`).
 *
 * The same profile minus everything private: no payout wallet, no verification
 * timestamp, no identity id. `wallet` is the owner's login address — the seed
 * for the official Nimiq identicon, not a payout destination.
 * `additionalProperties: false` in the spec is the guarantee that nothing else
 * leaks through this shape.
 */
export interface PublicProvider {
  id: string
  name: string
  slug: string
  headline: string
  bio: string
  avatarUrl: string
  /** Which identicon of `wallet` to draw. 0 is the wallet's own. */
  avatarVariant: number
  location: string
  /** Owner identity Nimiq address. Identicon seed, never shown as copy. */
  wallet: string
}

/**
 * One row of the public provider directory (`PublicProviderSummary`).
 *
 * `passCount` is the backend's count of what that provider currently has on
 * sale, taken from the same rows the directory is selected by. The browser used
 * to derive both the list and the count from the newest hundred public passes,
 * which silently truncated the directory and made the count "how many of this
 * provider's passes happened to be on this page" (docs/08-ARCHITECTURE.md §11).
 */
export interface PublicProviderSummary {
  provider: PublicProvider
  passCount: number
}

/* -- Service ------------------------------------------------------------- */

/** `Service.status`. ARCHIVED is terminal. */
export type ServiceStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'

export interface Service {
  id: string
  providerId: string
  name: string
  description: string
  /** `''` when the provider has not classified this service. */
  category: Category
  status: ServiceStatus
  createdAt: string
  updatedAt: string
}

/**
 * A service as the public sees it (`PublicService`).
 *
 * The category is the service's, and a public pass inherits it — which is
 * why discovery filters on the offer's service rather than on the pass.
 */
export interface PublicService {
  id: string
  name: string
  description: string
  category: Category
}

/* -- Pass ------------------------------------------------------------- */

/** `Pass.status`. */
export type PassStatus = 'DRAFT' | 'ACTIVE' | 'UNAVAILABLE' | 'ARCHIVED'

/** Curated visual identity (`Pass.accent`). */
export type PassAccent = 'PINE' | 'SLATE' | 'CLAY' | 'OLIVE' | 'PLUM' | 'AMBER'

export interface Pass {
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
  /** Visual identity for pass details. Null until the provider picks one. */
  accent: PassAccent | null
  /**
   * Cover uploaded to `POST /media`. Null until the provider adds a photo.
   * The bytes are not in this object; `coverUrl` is the fetch path.
   */
  coverMediaId: string | null
  /** Relative `/api/v1/media/{id}` on the Nimpass API, or null. */
  coverUrl: string | null
  status: PassStatus
  createdAt: string
  updatedAt: string
}

/**
 * A published pass with the provider and service it belongs to
 * (`PublicPass`). This is the only shape public discovery returns.
 */
export interface PublicPass {
  pass: Pass
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
  /**
   * The same amount as exact decimal NIM text, rendered by the backend.
   *
   * Display and payment-link use only — `valueLuna` stays the authority. It is
   * a string because the amount must never pass through a float on its way to
   * a screen or a QR (docs/05 §153).
   */
  valueNim: string
  /** `NP1:` + 32 hex characters. */
  data: string
  network: NimiqNetwork
  expiresAt: string
  /**
   * The scannable Nimiq payment request, built server-side.
   *
   * `nimiq:<address>?amount=<decimal NIM>&message=<NP1 reference>` — the
   * official request-link encoding, assembled by the backend from the Purchase
   * Intent's immutable snapshot so no browser can retarget the address or the
   * amount (docs/05 §13, §14, §85; ADR-006).
   *
   * Null when the backend could not encode one. The UI then shows no QR rather
   * than improvising a payment instruction.
   */
  uri: string | null
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

/**
 * How far the backend has got verifying the candidate transaction.
 *
 * `CONFIRMED` is the terminal state of a candidate whose purchase settled;
 * `SETTLEMENT_REVERSED` its counterpart when the payment turned out not to be
 * canonical. `AWAITING_FINALITY` is only reachable under
 * `NIMIQ_CONFIRMATION_POLICY=finality`.
 */
export type PaymentVerification =
  | 'SUBMITTED'
  | 'NOT_FOUND'
  | 'UNCERTAIN'
  | 'INCLUDED'
  | 'AWAITING_FINALITY'
  | 'CONFIRMED'
  | 'MISMATCH'
  | 'COMPENSATION_REQUIRED'
  | 'SETTLEMENT_REVERSED'

/**
 * The compensation case (`Compensation`).
 *
 * This is the contract's answer to a genuinely awkward outcome: the payment was
 * verified and macro-finalised on chain, but the pass's fixed expiration
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
  /**
   * Why the receipt and the entitlement disagree. Two reasons, mirror images.
   *
   * `PASS_EXPIRED_BEFORE_ACTIVATION` — real money arrived and no pass could be
   * issued, so a refund or reissue is owed and a second payment would be lost.
   *
   * `PAYMENT_SETTLEMENT_REVERSED` — a pass was issued on a validated
   * micro-block inclusion that then failed to become canonical, so the pass was
   * withdrawn and *nothing* is owed in either direction. The customer may buy
   * again; see `doNotPayAgain` below, which is the flag that distinguishes them.
   */
  reason: 'PASS_EXPIRED_BEFORE_ACTIVATION' | 'PAYMENT_SETTLEMENT_REVERSED'
  createdAt: string
  /** The backend's own explanation. Rendered as supporting detail, not as the headline. */
  message: string
  /**
   * Whether a second payment would be money lost.
   *
   * True for an expired pass, where the NIM has arrived and is sitting with the
   * provider. False for a reversed settlement, where no NIM ever left the
   * wallet — telling that customer not to pay again would leave them with
   * neither a pass nor a way to get one. Read it from here and never default
   * it: a falsy value read off the wrong object inverts the guarantee.
   */
  doNotPayAgain: boolean
  /** Always false. Refund and reissue are manual, between customer and provider. */
  automatedRefund: boolean
}

/**
 * How permanent the payment behind a purchase is (`Purchase.settlement`).
 *
 * A different question from `Purchase.status`, and the reason checkout is fast.
 * With `NIMIQ_CONFIRMATION_POLICY=inclusion` the backend confirms the purchase
 * and issues the pass as soon as the transaction is in a canonical micro block
 * and every economic check has passed — a second or two — while the macro block
 * that makes it irreversible is still up to a batch away, roughly a minute
 * (ADR-021).
 *
 * `INCLUDED` is that interval. It is not a pending state the UI should wait
 * out: the purchase is complete, the pass exists and works, and the backend
 * carries the payment to finality on its own. Gating pass visibility on this
 * would put the minute back.
 *
 * `CONTESTED` is the rare opposite: the inclusion never became canonical. The
 * purchase moves to `compensation_required` with the reversed reason, so the
 * customer-facing handling comes from `compensation` rather than from here.
 */
export type SettlementStatus = 'INCLUDED' | 'FINALIZED' | 'CONTESTED'

export interface Settlement {
  status: SettlementStatus
  /** Shorthand for `status === 'INCLUDED'`. Server-computed, never derived here. */
  provisional: boolean
  inclusionBlock: number
  /** The inclusion block's own timestamp, not a server clock reading. */
  includedAt: string
  /**
   * The macro height that will finalise this inclusion.
   *
   * Known from acceptance, because macro blocks sit at fixed multiples of the
   * batch length. Never a claim that the block exists — `finalityBlock` below
   * is the observed one and stays null until it does.
   */
  expectedFinalityBlock: number
  finalityBlock: number | null
  finalizedAt: string | null
  contestedAt: string | null
  contestReason: string | null
}

/**
 * A purchase intent and its authoritative payment state (`Purchase`).
 *
 * A purchase is the payment's lifecycle — a different state machine from the
 * pass it may eventually produce (docs/08 §41, docs/05 §53). Commercial terms
 * are snapshotted at intent creation, so later pass edits cannot move them.
 */
export interface Purchase {
  purchaseIntentId: string
  status: PurchaseUiStatus
  purchaseStatus: PurchaseRecordStatus
  passId: string
  passTitle: string
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
  purchasedPassId: string | null
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
  /**
   * How permanent the payment is. Null until one has been accepted.
   *
   * Read this to *describe* a settled purchase, never to decide whether the
   * customer may see their pass. A `completed` purchase with a provisional
   * settlement is the normal, intended outcome of a fast checkout.
   */
  settlement: Settlement | null
}

/* -- Purchased Pass ------------------------------------------------------ */

/** `PurchasedPass.status`. A purchased pass exists once payment was verified and finalised. */
export type PurchasedPassStatus = 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED'

/**
 * A purchased pass: the customer's owned copy of a Pass, with independent session progress.
 *
 * `usedSessions + remainingSessions === originalSessions` is an invariant the
 * *backend* guarantees; the frontend renders these numbers and never recomputes
 * them after a redemption (docs/08-ARCHITECTURE.md §37, §49).
 */
export interface PurchasedPass {
  id: string
  purchaseId: string
  ownerWallet: string
  /** Terms frozen at purchase time, so a later pass edit cannot change them. */
  passId: string
  passTitle: string
  serviceId: string
  providerId: string
  /**
   * Names and price as they were when this pass was bought.
   *
   * Snapshots, not lookups: a provider that renames itself tomorrow does not
   * rewrite what someone bought today, and reading them off the pass is also
   * what keeps pass screens from fetching a provider record per row.
   */
  serviceName: string
  providerName: string
  priceLuna: Luna
  originalSessions: number
  usedSessions: number
  remainingSessions: number
  status: PurchasedPassStatus
  createdAt: string
  expiresAt: string | null
  /** When the last session was used. Null while the pass is still usable. */
  completedAt: string | null
  /**
   * What the authenticated account is to this pass, decided by the backend.
   *
   * Both parties read the same record — the buyer who owns it and the provider
   * who has to deliver it — and this is the only thing that differs between
   * their two reads. It is deliberately not derived on this side from the
   * wallet or the provider id: deriving it is how a screen ends up offering a
   * control the server refuses.
   */
  viewerRole: ViewerRole
}

/** Which party to a purchased pass the authenticated account is. */
export type ViewerRole = 'OWNER' | 'PROVIDER'

/* -- Pass sessions ------------------------------------------------------- */

/**
 * `PassSession.status`.
 *
 * UNSCHEDULED and SCHEDULED are the two *open* states and differ only by
 * whether a date is set — "not scheduled" is a state, not a missing value.
 * COMPLETED is the only one that spends a session; it and CANCELLED are
 * terminal.
 */
export type PassSessionStatus = 'UNSCHEDULED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'

/** Who recorded a session as delivered. */
export type PassSessionActor = 'OWNER' | 'PROVIDER'

/**
 * One session of a purchased pass.
 *
 * Every session the pass was sold with exists as a row from the moment the
 * pass does, numbered 1..N and never renumbered. A pass is therefore a list of
 * sessions that happens to have a count, rather than a count that happens to
 * have a history.
 */
export interface PassSession {
  id: string
  passId: string
  /** 1-based, fixed at purchase. Render it; never compute it from the index. */
  sequenceNumber: number
  status: PassSessionStatus
  scheduledAt: string | null
  completedAt: string | null
  completedBy: PassSessionActor | null
  /** The signed redemption that spent this session, when one did. */
  redemptionId: string | null
  createdAt: string
  updatedAt: string
}

/**
 * One pass and all of its sessions, as one party sees it.
 *
 * The counters come from the pass row the backend wrote in the same
 * transaction as the session rows, so the two can never disagree — and neither
 * is recounted here.
 */
export interface PassSessionList {
  passId: string
  role: ViewerRole
  pass: PurchasedPass
  items: PassSession[]
  totalSessions: number
  completedSessions: number
  remainingSessions: number
}

/** The result of recording one delivered session. */
export interface SessionCompletion {
  session: PassSession
  pass: PurchasedPass
}

/** `PurchasedPassPage.status` filter. `''` means every status. */
export type PurchasedPassStatusFilter = '' | PurchasedPassStatus

/**
 * One page of the customer's passes (`PurchasedPassPage`).
 *
 * `nextCursor` is opaque and must be handed back unchanged, with the same
 * status filter. A null cursor is the end of the collection — not an error, and
 * not something to infer from a short page.
 */
export interface PurchasedPassPage {
  items: PurchasedPass[]
  nextCursor: string | null
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
  status: PurchasedPassStatus
  originalSessions: number
  usedSessions: number
  remainingSessions: number
  expiresAt: string | null
}

/** Set once the challenge has been consumed. */
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
 * There is no reference on this object and no `qrExpiresAt`. Authorizing spends
 * the session outright, so the contract never issues anything for a second
 * party to present.
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
  /** Present once the session has been spent. This is the proof it happened. */
  redemption: RedemptionChallengeRedemption | null
}

/** One consumed session (`RedemptionHistoryItem`). Only consumed rows exist. */
export interface RedemptionHistoryItem {
  redemptionId: string
  challengeId: string
  passId: string
  providerId: string
  serviceId: string
  sourcePassId: string
  /** 1-based position in this pass's session sequence. */
  sessionOrdinal: number
  ownerWallet: string
  redeemedAt: string
  status: 'CONSUMED'
}

/**
 * A published pass flattened with its provider and service.
 *
 * `PublicPass` nests three objects, which is awkward to render; this is the
 * same data with one level removed. It is a view of the response, not a richer
 * model — every field comes from the wire, and the fields the contract does not
 * have (category, provider avatar or bio) are simply absent rather than
 * defaulted. A cover, when present, is the same `coverUrl` the Pass already
 * carries.
 */
export interface PassListing extends Pass {
  provider: PublicProvider
  service: PublicService
}

export function toPassListing(offer: PublicPass): PassListing {
  return { ...offer.pass, provider: offer.provider, service: offer.service }
}
