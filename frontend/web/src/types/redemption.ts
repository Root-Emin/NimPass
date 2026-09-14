import type {
  Pass,
  RedemptionChallenge,
  RedemptionConfirmation,
  RedemptionLookup,
} from './domain'

/**
 * The two redemption experiences, as state machines.
 *
 * Redemption has two participants with different jobs (docs/09-SECURITY.md §34):
 * the customer proves the pass is theirs and offers a short-lived challenge,
 * the provider validates it and consumes exactly one session. Each side gets its
 * own machine because each sees a different subset of the truth.
 *
 * Neither machine may reach a success state on its own. "A session was used" is
 * a backend fact (docs/08-ARCHITECTURE.md §49, docs/01-PRODUCT.md §49) — these
 * types exist so the UI can be honest about *not knowing yet*, which is the
 * state both sides spend most of their time in.
 */

/* -- Customer ------------------------------------------------------------ */

/**
 * The customer half of a redemption.
 *
 * The ordering matters more than the names. A reference only exists after the
 * pass owner has signed, so there is no state that carries a QR before
 * `QR_READY`, and no way to reach `QR_READY` without passing through
 * `AWAITING_SIGNATURE`. That is the contract's ceremony expressed as types: a
 * usable code cannot be represented without the signature that earned it.
 *
 * The terminal error states are separated rather than collapsed into one
 * `FAILED`, because each has a genuinely different next step — start again,
 * buy again, or nothing at all.
 */
export type CustomerRedemptionState =
  /** Nothing started. The pass shows "Use a session". */
  | { kind: 'IDLE' }
  /** Asking the backend for a challenge. Consumes nothing. */
  | { kind: 'CREATING_CHALLENGE' }
  /**
   * A challenge exists and is waiting to be signed.
   *
   * No reference yet, so nothing to show a provider. This is the state the
   * signing explanation belongs in (§7).
   */
  | { kind: 'AWAITING_SIGNATURE'; challenge: RedemptionChallenge }
  /** The pass owner is in Nimiq Pay's native sign dialog. */
  | { kind: 'SIGNING'; challenge: RedemptionChallenge }
  /** Signature captured; the backend is verifying it. */
  | { kind: 'AUTHORIZING'; challenge: RedemptionChallenge }
  /**
   * Authorised, with a live reference on screen, waiting for the provider.
   *
   * `reference` is held in memory only, for as long as this state lives. It is
   * never written to storage, a URL, a log or telemetry (§13).
   */
  | {
      kind: 'QR_READY'
      challenge: RedemptionChallenge
      reference: string
      secondsLeft: number
    }
  /**
   * Authorised, but this session holds no reference — after a reload, since
   * reading a challenge back never returns one.
   *
   * Recoverable: rotating through the create endpoint issues a fresh reference
   * without a second signature. The UI offers exactly that (§14, §40).
   */
  | { kind: 'AUTHORIZED_NO_REFERENCE'; challenge: RedemptionChallenge }
  /** The backend reports the session was consumed. Counts come from the backend. */
  | { kind: 'CONSUMED'; remainingSessions: number; completed: boolean }
  /** The challenge ran out. Nothing was consumed; a new one can be started. */
  | { kind: 'EXPIRED' }
  /** The pass moved on since this challenge was made. Start again. */
  | { kind: 'STALE' }
  /** Someone already redeemed this challenge. Not an error to retry. */
  | { kind: 'ALREADY_CONSUMED' }
  /** No sessions remain. The pass is finished. */
  | { kind: 'PASS_COMPLETED' }
  /** The pass is outside its usable window. */
  | { kind: 'PASS_EXPIRED' }
  /** The backend rejected the signature. Nothing was consumed. */
  | { kind: 'INVALID_SIGNATURE'; challenge: RedemptionChallenge | null }
  /** The wallet dialog was dismissed. A normal outcome, not a failure (§8). */
  | { kind: 'CANCELLED'; challenge: RedemptionChallenge | null }
  /** The session ended. Signing in again is the way forward. */
  | { kind: 'AUTH_REQUIRED' }
  /** We could not reach the backend, or it answered something we don't model. */
  | { kind: 'UNCERTAIN'; message: string }

export type CustomerRedemptionKind = CustomerRedemptionState['kind']

/** Whether the customer is mid-ceremony, with a challenge that may still resolve. */
export function isChallengeLive(state: CustomerRedemptionState): boolean {
  return (
    state.kind === 'AWAITING_SIGNATURE' ||
    state.kind === 'SIGNING' ||
    state.kind === 'AUTHORIZING' ||
    state.kind === 'QR_READY' ||
    state.kind === 'AUTHORIZED_NO_REFERENCE'
  )
}

/** Whether a redemption may be started from here. */
export function mayStartRedemption(state: CustomerRedemptionState): boolean {
  return (
    state.kind === 'IDLE' ||
    state.kind === 'EXPIRED' ||
    state.kind === 'STALE' ||
    state.kind === 'CANCELLED' ||
    state.kind === 'INVALID_SIGNATURE' ||
    state.kind === 'UNCERTAIN'
  )
}

/** Whether a wallet or network step is in flight. */
export function isRedemptionBusy(state: CustomerRedemptionState): boolean {
  return (
    state.kind === 'CREATING_CHALLENGE' ||
    state.kind === 'SIGNING' ||
    state.kind === 'AUTHORIZING'
  )
}

/** Whether a pass is in a shape that allows starting a redemption at all. */
export function passIsRedeemable(pass: Pass): boolean {
  return pass.status === 'ACTIVE' && pass.remainingSessions > 0
}

/**
 * Why a pass cannot be used, in the customer's words.
 *
 * Returns null when it can. Each case is distinct because the next step differs:
 * a completed pass can be repurchased, an expired one cannot be revived
 * (docs/02-USER-FLOWS.md §60-§62).
 */
export function redemptionBlockedReason(pass: Pass): string | null {
  if (pass.status === 'COMPLETED') return 'You have used every session on this pass.'
  if (pass.status === 'EXPIRED') return 'This pass has expired.'
  if (pass.status === 'CANCELLED') return 'This pass was cancelled and can no longer be used.'
  if (pass.remainingSessions <= 0) return 'This pass has no sessions remaining.'
  return null
}

/* -- Provider ------------------------------------------------------------ */

/**
 * The provider half.
 *
 * The whole point of this machine is the gap between `CONFIRMING` and
 * `COMPLETED`. A lookup validates a reference and returns context; it consumes
 * nothing. Only an explicit human confirmation moves a counter, and the scanner
 * must never skip that step — pointing a camera at a code is not consent to
 * spend someone's session (§18, §22).
 */
export type ProviderRedemptionState =
  /** No code entered. Scanner closed; nothing has asked for a camera. */
  | { kind: 'IDLE' }
  /** Looking a scanned or typed reference up. Still consuming nothing. */
  | { kind: 'LOOKING_UP'; reference: string }
  /**
   * A valid, authorised reference. The provider is being shown what confirming
   * would consume, and has not confirmed yet.
   */
  | { kind: 'CONFIRMING'; reference: string; lookup: RedemptionLookup }
  /** Confirmation in flight. One session is being consumed, server-side. */
  | { kind: 'COMPLETING'; reference: string; lookup: RedemptionLookup }
  /** The backend consumed exactly one session and reported the new balance. */
  | { kind: 'COMPLETED'; result: RedemptionConfirmation; lookup: RedemptionLookup | null }
  /**
   * The reference was refused. `reason` is customer-facing copy for a domain
   * outcome — never a status code, never a hint about whose code it was.
   */
  | { kind: 'REJECTED'; reason: string; code: string }
  /** The lookup or confirmation could not be carried out at all. */
  | { kind: 'UNAVAILABLE'; message: string }

/** Whether the provider may scan or type a new reference from here. */
export function mayScanAgain(state: ProviderRedemptionState): boolean {
  return (
    state.kind === 'IDLE' ||
    state.kind === 'REJECTED' ||
    state.kind === 'UNAVAILABLE' ||
    state.kind === 'COMPLETED'
  )
}

/** Whether a request is in flight; the confirm control locks on this (§34). */
export function isProviderBusy(state: ProviderRedemptionState): boolean {
  return state.kind === 'LOOKING_UP' || state.kind === 'COMPLETING'
}
