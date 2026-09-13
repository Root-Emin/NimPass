import type { Pass, RedemptionChallenge } from './domain'

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

export type CustomerRedemptionState =
  /** Nothing started. The pass shows "Use a session". */
  | { kind: 'IDLE' }
  /** Asking the backend for a challenge. No session is consumed by this. */
  | { kind: 'REQUESTING' }
  /**
   * A challenge exists and is on screen. The provider has not acted yet.
   *
   * Showing a code is not using a session (docs/02-USER-FLOWS.md §48, §96).
   */
  | { kind: 'PRESENTED'; challenge: RedemptionChallenge; secondsLeft: number }
  /** The pass owner is signing the challenge in Nimiq Pay (§50). */
  | { kind: 'AWAITING_SIGNATURE'; challenge: RedemptionChallenge }
  /** Signature sent; the backend is checking it. */
  | { kind: 'AUTHORIZING'; challenge: RedemptionChallenge }
  /**
   * The challenge ran out before the provider confirmed.
   *
   * Expiry never consumes a session (docs/09-SECURITY.md §48).
   */
  | { kind: 'EXPIRED'; challenge: RedemptionChallenge }
  /**
   * The backend reports one fewer session than when this challenge opened.
   *
   * `remaining` is read back from the pass, never decremented locally
   * (docs/08-ARCHITECTURE.md §49).
   */
  | { kind: 'RESOLVED'; remaining: number }
  /** The challenge could not be created or authorised. Nothing was consumed. */
  | { kind: 'FAILED'; message: string }

/** Whether the customer is looking at a live challenge. */
export function isChallengeLive(state: CustomerRedemptionState): boolean {
  return (
    state.kind === 'PRESENTED' ||
    state.kind === 'AWAITING_SIGNATURE' ||
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

export type ProviderRedemptionState =
  /** No code entered yet. Scanner is closed; nothing has asked for a camera. */
  | { kind: 'IDLE' }
  /** Looking a scanned or typed reference up. */
  | { kind: 'LOOKING_UP'; reference: string }
  /**
   * A valid challenge was found and the provider is being asked to confirm.
   *
   * `pass` is the customer pass as the *backend* described it for this
   * redemption — the provider never sees a pass they are not servicing
   * (docs/09-SECURITY.md §92).
   */
  | { kind: 'CONFIRMING'; reference: string; redemptionId: string; pass: ProviderPassView }
  /** Confirmation sent. One session is being consumed, atomically, server-side. */
  | { kind: 'COMPLETING'; reference: string; redemptionId: string }
  /** The backend consumed exactly one session and reported the new balance. */
  | { kind: 'COMPLETED'; remaining: number; packageTitle: string }
  /**
   * The code was refused. `reason` is a domain outcome, not a stack trace:
   * expired, already used, wrong provider, no sessions left
   * (docs/02-USER-FLOWS.md §56-§60).
   */
  | { kind: 'REJECTED'; reason: string }
  /** The lookup or completion could not be carried out at all. */
  | { kind: 'UNAVAILABLE'; message: string }

/**
 * The slice of a customer pass a provider may see while redeeming.
 *
 * Deliberately narrow (docs/09-SECURITY.md §38, §92): enough to confirm the
 * right person is in front of them and to understand the consequence, and
 * nothing about the customer's wallet, other passes or other providers.
 */
export interface ProviderPassView {
  packageTitle: string
  serviceTitle: string
  sessionsRemaining: number
  sessionsTotal: number
}
