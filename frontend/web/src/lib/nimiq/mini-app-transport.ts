import {
  getNetworkReadiness,
  listAccounts,
  sendBasicTransactionWithData,
  signMessage,
} from './client'
import { NimiqOperationError, nimiqError } from './errors'
import type {
  ChallengeSignRequest,
  NetworkReadiness,
  WalletPaymentRequest,
  WalletSignature,
  WalletTransport,
} from './transport'

/**
 * The Nimiq Pay transport: wallet access inside the Mini App WebView.
 *
 * A thin shell over `./client`, which remains the single boundary to
 * `@nimiq/mini-app-sdk` — its approval lock, error normalisation and provider
 * lifecycle are unchanged, and every documented provider method it exposes is
 * still reached the same way (docs/04-NIMIQ-MINI-APPS.md §13, §58).
 *
 * What this class adds is only the shape the rest of Nimpass now speaks, so the
 * Hub can offer the same one. Native approval sheets are not popups, so nothing
 * here needs the Hub's popup rule. The UI still separates account selection,
 * signing and payment approval into explicit user actions.
 */
export class MiniAppTransport implements WalletTransport {
  readonly kind = 'mini-app' as const
  /**
   * Null on purpose.
   *
   * The Mini Apps API documents `sign()`'s parameters and result but not what
   * the host actually signs, and `@nimiq/mini-app-sdk` forwards the message
   * untouched — so this adapter cannot honestly name a scheme. The backend
   * keeps verifying under its configured `NIMIQ_SIGNING_SCHEME`, which
   * `backend/cmd/verify-sign-fixture` exists to settle from a real device.
   * Claiming a scheme here would hide that open question rather than answer it.
   */
  readonly signingScheme = null
  readonly gesturePerOperation = false

  /**
   * The first address the wallet is willing to reveal.
   *
   * Opens a native dialog (official API: `listAccounts` confirmation yes).
   */
  async requestAccount(): Promise<string> {
    const accounts = await listAccounts(true)
    const first = accounts[0]
    if (!first) throw new NimiqOperationError(nimiqError('NO_ACCOUNTS'))
    return first
  }

  async signChallenge(request: PromiseLike<ChallengeSignRequest>): Promise<WalletSignature> {
    const { message } = await request
    const signed = await signMessage(message)
    // `publicKey` and `signature` travel byte-for-byte as the wallet produced
    // them. Re-encoding, padding or normalising them here would hide whether
    // the host's output interoperates with the backend's verification rather
    // than settle it (see `src/api/auth.ts`).
    return { publicKey: signed.publicKey, signature: signed.signature, signer: null }
  }

  async pay(request: PromiseLike<WalletPaymentRequest>): Promise<string> {
    const value = await request
    // Straight from `paymentRequest`, unmodified: `valueLuna` maps to the SDK's
    // `value`, and `data` is passed through verbatim because the backend
    // matches the on-chain transaction against exactly that string.
    //
    // There is no sender parameter in the provider API — Nimiq Pay pays from
    // the account the user approves. The backend still requires that account to
    // be the wallet the intent was issued for, and a mismatch surfaces as a
    // refused submission rather than a silently wrong payment (docs/05 §43).
    return sendBasicTransactionWithData({
      recipient: value.recipient,
      value: value.valueLuna,
      data: value.data,
    })
  }

  async networkReadiness(): Promise<NetworkReadiness | null> {
    return getNetworkReadiness()
  }
}
