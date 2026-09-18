import type { Luna } from '@/types/domain'
import type { WalletTransportKind } from '@/types/wallet'

/**
 * The wallet transport boundary.
 *
 * Nimpass is web-first and Mini-App-compatible (docs/04-NIMIQ-MINI-APPS.md §6),
 * so the same product meets a wallet through two official Nimiq surfaces:
 *
 *   Nimiq Pay WebView  →  `@nimiq/mini-app-sdk`   (injected Nimiq provider)
 *   ordinary browser   →  `@nimiq/hub-api`        (the Nimiq Hub)
 *
 * This interface is the *only* place that difference exists. Above it there is
 * one authentication model, one purchase lifecycle, one set of backend
 * contracts and one security model; below it there are two adapters. Nothing in
 * `src/app`, `src/pages`, `src/components` or `src/hooks` branches on which one
 * answered (docs/08-ARCHITECTURE.md §15-§17).
 *
 * Three rules shape every method:
 *
 *  1. Nothing here decides an outcome. A signature is bytes for the backend to
 *     verify; a transaction hash is a candidate for the backend to look up
 *     (docs/05 §34-§35, docs/09-SECURITY.md §2).
 *  2. No private key, seed phrase or wallet secret is ever handled. Both
 *     transports are security boundaries that own approval and signing
 *     (docs/04 §24-§25, docs/09 §7).
 *  3. Result shapes are normalised here, not by callers. The Mini App provider
 *     returns hex strings; the Hub returns `Uint8Array`s. Application code sees
 *     one shape.
 *
 * ## Why the request arguments are promises
 *
 * The Hub opens a browser popup, and the official guidance is to call Hub
 * methods synchronously inside the user's click — "not after awaiting other
 * async operations" (https://nimiq.dev/hub/getting-started). But every wallet
 * operation Nimpass performs needs backend-authored input first: the exact
 * challenge message, or the recipient/amount/reference of a purchase intent.
 *
 * `@nimiq/hub-api` solves this itself: its request methods accept
 * `Promise<Request> | Request`, and `PopupRequestBehavior.request()` opens the
 * window *before* awaiting the arguments. So the adapter takes a promise, hands
 * it straight to the Hub, and the popup opens on the click while the backend
 * call is still in flight. The Mini App adapter simply awaits it — Nimiq Pay's
 * native sheets have no popup rule.
 *
 * This is why callers pass `signChallenge(fetchChallenge())` rather than
 * `signChallenge(await fetchChallenge())`. Awaiting first is the bug the Hub
 * documentation warns about.
 */

/**
 * Thrown by the *caller's* request promise to say the operation was abandoned
 * before the wallet ever had anything to do: the backend refused the purchase
 * intent, the challenge could not be issued, the attempt was superseded.
 *
 * Adapters rethrow it untouched instead of normalising it into a wallet
 * failure, because it is not one — and a backend's specific answer ("this
 * pass is past its purchase cutoff") must not arrive at the UI as
 * "something went wrong with the wallet". Every other rejection is normalised.
 */
export class WalletRequestAbandoned extends Error {}

/** A signature, normalised to the hex the backend contract expects. */
export interface WalletSignature {
  /** 64 hex characters (32-byte Ed25519 public key). */
  publicKey: string
  /** 128 hex characters (64-byte Ed25519 signature). */
  signature: string
  /**
   * The address the transport says produced this signature, when it says so.
   *
   * A *hint* only. The backend derives the real signer from `publicKey` and
   * requires it to match the challenge's wallet (docs/09-SECURITY.md §19);
   * nothing is authorised on this field.
   */
  signer: string | null
}

/** What the wallet is asked to sign: a message the backend authored. */
export interface ChallengeSignRequest {
  /** The wallet the backend bound the challenge to. */
  wallet: string
  /**
   * The server's exact UTF-8 string. Never reconstructed, trimmed or prefixed —
   * the backend verifies these bytes and nothing else (docs/09 §14, §18).
   */
  message: string
}

/** What the wallet is asked to pay: an instruction the backend authored. */
export interface WalletPaymentRequest {
  /** Verified payout wallet, snapshotted into the purchase intent. */
  recipient: string
  /** Exact integer Luna. The displayed price is never used (docs/08 §71). */
  valueLuna: Luna
  /**
   * The opaque `NP1:` payment reference, as UTF-8 transaction data.
   *
   * Passed through verbatim. The backend matches the on-chain transaction
   * against exactly this string, so regenerating it is how a verified payment
   * becomes an unrecognised one (docs/05 §45, `openapi.yaml` PaymentRequest).
   */
  data: string
  /**
   * The wallet the backend will require as the transaction sender.
   *
   * `Purchase.customerWallet` — the authenticated identity the intent was
   * issued for. The backend rejects a transaction from any other sender, so a
   * transport that can constrain the sender must do so rather than let the
   * customer discover the mismatch after paying (docs/05 §43, §131).
   */
  sender: string
}

/** Read-only pre-flight, where the transport exposes one. */
export interface NetworkReadiness {
  consensusEstablished: boolean
  blockNumber: number | null
}

export interface WalletTransport {
  readonly kind: WalletTransportKind

  /**
   * The signing scheme the backend must verify this transport's signatures
   * under, or null to let the deployment's configured default stand.
   *
   * Only the Hub declares one, and only because the Hub documents exactly what
   * it signs: `sha256('\x16Nimiq Signed Message:\n' + message.length + message)`
   * (https://nimiq.github.io/hub/api-reference/sign-message). The Mini App
   * host's preprocessing is not documented, so this adapter claims nothing and
   * the backend keeps using `NIMIQ_SIGNING_SCHEME` — the value
   * `backend/cmd/verify-sign-fixture` exists to settle from a real device.
   */
  readonly signingScheme: 'hub' | null

  /** True when each wallet operation needs its own user gesture. */
  readonly gesturePerOperation: boolean

  /**
   * Asks the wallet which address it will act as.
   *
   * Opens a confirmation (Nimiq Pay sheet, or Hub popup), so it must be called
   * from a user action and never on page load (docs/04 §55-§56).
   *
   * An address is an identity *hint*, never proof of control — authorisation
   * always needs a server-issued challenge and a signature (docs/09 §11, §19).
   */
  requestAccount(): Promise<string>

  /** Signs a backend-issued challenge. See the promise note above. */
  signChallenge(request: PromiseLike<ChallengeSignRequest>): Promise<WalletSignature>

  /**
   * Pays a backend-issued purchase intent and returns the transaction hash.
   *
   * The hash is a *candidate*: it proves nothing, creates no pass, and is only
   * ever evidence for the backend to verify (docs/05 §33-§35).
   */
  pay(request: PromiseLike<WalletPaymentRequest>): Promise<string>

  /**
   * Read-only network pre-flight, or null when the transport does not expose
   * one.
   *
   * The Nimiq provider documents `isConsensusEstablished()` and
   * `getBlockNumber()`; the Hub exposes no equivalent to a calling site, and
   * inventing an answer would be faking wallet state (docs/08 §14). Null means
   * "this transport cannot tell us", and callers skip the check rather than
   * treat silence as a failure.
   */
  networkReadiness(): Promise<NetworkReadiness | null>
}
