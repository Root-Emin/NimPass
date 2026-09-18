import type HubApi from '@nimiq/hub-api'
import type { SignedMessage, SignedTransaction } from '@nimiq/hub-api'

import { NimiqOperationError, nimiqError, throwNormalized } from './errors'
import { resolveHubEndpoint } from './hub-endpoint'
import { WalletRequestAbandoned } from './transport'
import type {
  ChallengeSignRequest,
  NetworkReadiness,
  WalletPaymentRequest,
  WalletSignature,
  WalletTransport,
} from './transport'

/**
 * The Nimiq Hub transport: wallet access in an ordinary browser.
 *
 * Everything here maps 1:1 onto the official Hub API
 * (https://nimiq.github.io/hub/api-reference). Nothing is invented, and the
 * account-management methods the Hub also exposes — `login()`, `signup()`,
 * `onboard()`, `export()` — are deliberately absent: they are restricted to
 * Nimiq's own origins, and a third-party application authenticates with
 * `chooseAddress()` + `signMessage()` instead.
 *
 *   chooseAddress   user picks which address to act as
 *   signMessage     signs the backend's exact challenge
 *   checkout        pays a backend-issued purchase intent, and relays it
 *
 * ## The popup rule
 *
 * The Hub opens a browser window, and browsers grant one popup per user
 * activation, only while the click is still being handled. The official
 * guidance is therefore to call Hub methods synchronously inside the handler
 * and never after awaiting something else (https://nimiq.dev/hub/getting-started).
 *
 * Two consequences, both deliberate rather than worked around:
 *
 *  - Backend input arrives as a *promise*. `HubApi`'s methods accept
 *    `Promise<Request>`, and `PopupRequestBehavior.request()` opens the window
 *    before awaiting the arguments, so the challenge or purchase intent can
 *    still be in flight when the popup appears.
 *  - Two wallet operations need two clicks. `gesturePerOperation` says so, and
 *    the sign-in flow pauses between choosing an address and signing rather
 *    than firing a second popup the browser would swallow.
 *
 * ## What is never done here
 *
 * No private key, seed phrase or wallet secret is handled: the Hub owns
 * approval and signing exactly as Nimiq Pay does (docs/09-SECURITY.md §7).
 * Nothing here decides that a payment succeeded — `checkout()` returning is not
 * proof of anything the backend has not verified (docs/05 §34).
 */

/** Shown in the Hub's own UI as the requesting application. */
const APP_NAME = 'Nimpass'

export class HubTransport implements WalletTransport {
  readonly kind = 'hub' as const
  /**
   * The Hub documents its signed-message envelope exactly:
   * `sign(sha256('\x16Nimiq Signed Message:\n' + message.length + message))`
   * (https://nimiq.github.io/hub/api-reference/sign-message). The backend
   * implements that as `nimiq.HubSignedMessage`, so this transport can name its
   * scheme with certainty — unlike the Mini App host, whose preprocessing is
   * undocumented.
   */
  readonly signingScheme = 'hub' as const
  readonly gesturePerOperation = true

  private readonly hub: HubApi

  constructor(hub: HubApi) {
    this.hub = hub
  }

  async requestAccount(): Promise<string> {
    const result = await guard(() => this.hub.chooseAddress({ appName: APP_NAME }))
    if (!result?.address) throw new NimiqOperationError(nimiqError('NO_ACCOUNTS'))
    return result.address
  }

  async signChallenge(request: PromiseLike<ChallengeSignRequest>): Promise<WalletSignature> {
    // The promise goes to the Hub untouched: awaiting it here would close the
    // popup window the click opened. `signer` pins the request to the wallet
    // the backend issued the challenge for, so the Hub cannot quietly sign with
    // a different account and leave the backend to reject it (docs/09 §19).
    const signed = await guard(() =>
      this.hub.signMessage(
        Promise.resolve(request).then((value) => ({
          appName: APP_NAME,
          signer: value.wallet,
          message: value.message,
        })),
      ),
    )
    return normalizeSignedMessage(signed)
  }

  async pay(request: PromiseLike<WalletPaymentRequest>): Promise<string> {
    const signed = await guard(() =>
      this.hub.checkout(
        Promise.resolve(request).then((value) => ({
          appName: APP_NAME,
          // `forceSender` makes the Hub refuse rather than pay from another
          // account. The backend requires the transaction sender to equal the
          // wallet the intent was issued for, so a mismatch here is a payment
          // that can never settle — better refused before the money moves
          // (docs/05 §43, backend `validateEvidence`).
          sender: value.sender,
          forceSender: true,
          recipient: value.recipient,
          value: value.valueLuna,
          // Bytes, not a string. The backend compares the transaction's
          // recipient data against the exact UTF-8 bytes of the `NP1:` payment
          // reference, and encoding it here leaves nothing for the Hub to
          // interpret (docs/05 §45).
          extraData: new TextEncoder().encode(value.data),
          // No `fee` and no `validityDuration`: the wallet's own policy applies
          // (docs/05 §29-§30). No `flags` and no `recipientType`: the defaults
          // are the basic transaction the backend's verification requires.
        })),
      ),
    )
    return transactionHashOf(signed)
  }

  /**
   * The Hub exposes no consensus or block-height call to a calling site, so
   * this reports "cannot tell" rather than inventing an answer. The Hub
   * maintains its own network connection and will not relay a transaction it
   * cannot broadcast, which is the check this pre-flight stands in for.
   */
  async networkReadiness(): Promise<NetworkReadiness | null> {
    return null
  }
}

/**
 * Loads the Hub client, or explains why there isn't one.
 *
 * Deliberately eager — `WalletProvider` calls this at startup — because the
 * module import is an `await`, and an `await` between the user's click and
 * `window.open` is what gets a popup blocked. By the time anyone presses Login
 * the client exists and the call path from the click is synchronous.
 */
export async function createHubTransport(endpoint = resolveHubEndpoint()): Promise<HubTransport> {
  const { default: Hub } = await import('@nimiq/hub-api')
  return new HubTransport(new Hub(endpoint))
}

/** Normalises the Hub's `Uint8Array` result into the contract's hex strings. */
function normalizeSignedMessage(signed: SignedMessage): WalletSignature {
  const publicKey = toHex(signed.signerPublicKey)
  const signature = toHex(signed.signature)
  if (publicKey.length !== 64 || signature.length !== 128) {
    // The contract's `Proof` schema is explicit about both lengths. Sending
    // something else would be a 400 the user could do nothing about, so it is
    // reported as a wallet failure here instead.
    throw new NimiqOperationError(nimiqError('UNKNOWN', 'unexpected signature encoding'))
  }
  return { publicKey, signature, signer: signed.signer ?? null }
}

/**
 * The transaction hash from a checkout result.
 *
 * `checkout()` can resolve to `SimpleResult` for a version-2 multi-currency
 * request. Nimpass only ever sends a version-1 NIM request, so a result without
 * a hash means something changed underneath us — and a purchase with no hash to
 * report is not a purchase the backend can verify.
 */
function transactionHashOf(result: SignedTransaction | { success: true }): string {
  const hash = (result as SignedTransaction).hash
  if (typeof hash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw new NimiqOperationError(nimiqError('UNKNOWN', 'checkout returned no transaction hash'))
  }
  return hash
}

function toHex(value: unknown): string {
  if (typeof value === 'string') {
    const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
    return /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0 ? hex.toLowerCase() : ''
  }
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : value instanceof Uint8Array
        ? value
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : isByteArray(value)
            ? Uint8Array.from(value)
            : null
  if (!bytes) return ''
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isByteArray(value: unknown): value is ArrayLike<number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'length' in value &&
    typeof (value as { length: unknown }).length === 'number'
  )
}

/**
 * Runs a Hub call and normalises whatever it throws (docs/04 §32).
 *
 * A `WalletRequestAbandoned` passes through untouched: it came out of the
 * caller's own request promise, which the Hub resolves inside the call, and it
 * describes a backend decision rather than a wallet failure.
 */
async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof WalletRequestAbandoned) throw error
    if (error instanceof NimiqOperationError) throw error
    throwNormalized(error)
  }
}
