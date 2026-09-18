import type { PurchasedPass, RedemptionChallenge } from './domain'

/**
 * Using a session, as a state machine.
 *
 * There is one participant. The pass owner asks for a challenge, signs it, and
 * the backend spends one session against that signature — so the machine runs
 * from the pass straight to a consumed session with nobody to wait for.
 *
 * It still may not reach a success state on its own. "A session was used" is a
 * backend fact (docs/08-ARCHITECTURE.md §49, docs/01-PRODUCT.md §49), and the
 * counts in `CONSUMED` are the ones the backend reported, never arithmetic done
 * here. The type exists so the UI can be honest about *not knowing yet*.
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
  /** The backend reports the session was consumed. Counts come from the backend. */
  | { kind: 'CONSUMED'; remainingSessions: number; completed: boolean }
  /** The challenge ran out. Nothing was consumed; a new one can be started. */
  | { kind: 'EXPIRED' }
  /** The pass moved on since this challenge was made. Start again. */
  | { kind: 'STALE' }
  /** This challenge was already spent — a replayed submit. Nothing happened. */
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

/** Whether the owner is mid-ceremony, with a challenge that may still resolve. */
export function isChallengeLive(state: CustomerRedemptionState): boolean {
  return (
    state.kind === 'AWAITING_SIGNATURE' ||
    state.kind === 'SIGNING' ||
    state.kind === 'AUTHORIZING'
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
export function passIsRedeemable(pass: PurchasedPass): boolean {
  return pass.status === 'ACTIVE' && pass.remainingSessions > 0
}

/**
 * Why a pass cannot be used, in the customer's words.
 *
 * Returns null when it can. Each case is distinct because the next step differs:
 * a completed pass can be repurchased, an expired one cannot be revived
 * (docs/02-USER-FLOWS.md §60-§62).
 */
export function redemptionBlockedReason(pass: PurchasedPass): string | null {
  if (pass.status === 'COMPLETED') return 'You have used every session on this pass.'
  if (pass.status === 'EXPIRED') return 'This pass has expired.'
  if (pass.status === 'CANCELLED') return 'This pass was cancelled and can no longer be used.'
  if (pass.remainingSessions <= 0) return 'This pass has no sessions remaining.'
  return null
}
