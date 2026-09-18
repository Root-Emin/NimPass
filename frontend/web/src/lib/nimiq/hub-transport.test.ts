import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Verifies the Hub adapter against the official Nimiq Hub API.
 *
 * The test double sits at the `@nimiq/hub-api` boundary, which is the only
 * place Nimpass touches the Hub. Everything asserted below — method names,
 * request field names, result shapes, the documented error strings, and the
 * fact that request arguments may be a promise — comes from
 * https://nimiq.github.io/hub/api-reference and the pass's own typings.
 *
 * Two properties get the most attention, because both are load-bearing for
 * money:
 *
 *  - the `NP1:` payment reference reaches the transaction byte-for-byte, and
 *  - the popup opens before the backend call is awaited, which is what makes a
 *    desktop payment possible at all (https://nimiq.dev/hub/getting-started).
 */

const chooseAddress = vi.fn()
const signMessage = vi.fn()
const checkout = vi.fn()

class FakeHubApi {
  static lastEndpoint: string | null = null

  constructor(endpoint: string) {
    FakeHubApi.lastEndpoint = endpoint
  }

  chooseAddress(...args: unknown[]) {
    return chooseAddress(...args)
  }
  signMessage(...args: unknown[]) {
    return signMessage(...args)
  }
  checkout(...args: unknown[]) {
    return checkout(...args)
  }
}

vi.mock('@nimiq/hub-api', () => ({ default: FakeHubApi }))

const WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081'
const REFERENCE = `NP1:${'a'.repeat(32)}`
const TX_HASH = 'b'.repeat(64)

/** `SignedMessage` per the Hub: hex is normalised by the adapter, not the Hub. */
function signedMessage() {
  return {
    signer: WALLET,
    signerPublicKey: new Uint8Array(32).fill(0xab),
    signature: new Uint8Array(64).fill(0xcd),
  }
}

async function loadTransport() {
  const { createHubTransport } = await import('./hub-transport')
  return createHubTransport('https://hub.nimiq-testnet.com')
}

beforeEach(() => {
  vi.resetModules()
  chooseAddress.mockReset()
  signMessage.mockReset()
  checkout.mockReset()
  FakeHubApi.lastEndpoint = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('adapter → official Nimiq Hub API', () => {
  it('reaches the Hub only through the configured endpoint', async () => {
    await loadTransport()
    expect(FakeHubApi.lastEndpoint).toBe('https://hub.nimiq-testnet.com')
  })

  it('reports itself as the Hub runtime, with one gesture per wallet window', async () => {
    const transport = await loadTransport()
    expect(transport.kind).toBe('hub')
    // Browsers grant one popup per user activation, so a flow needing two
    // wallet windows needs two clicks. The UI reads this, not the kind.
    expect(transport.gesturePerOperation).toBe(true)
  })

  it('names "hub" as its signing scheme, because the Hub documents its envelope', async () => {
    // sha256('\x16Nimiq Signed Message:\n' + length + message). The backend
    // implements exactly this as `nimiq.HubSignedMessage`, so the claim is not
    // a guess — unlike the Mini App host, which documents nothing and so
    // declares nothing.
    const transport = await loadTransport()
    expect(transport.signingScheme).toBe('hub')
  })

  it('chooses an address with chooseAddress(), never the restricted login()', async () => {
    chooseAddress.mockResolvedValue({ address: WALLET, label: 'Main' })
    const transport = await loadTransport()

    expect(await transport.requestAccount()).toBe(WALLET)
    expect(chooseAddress).toHaveBeenCalledWith({ appName: 'Nimpass' })
  })

  it('normalises the Hub signature into the hex the backend contract expects', async () => {
    signMessage.mockResolvedValue(signedMessage())
    const transport = await loadTransport()

    const signature = await transport.signChallenge(
      Promise.resolve({ wallet: WALLET, message: 'NIMPASS\nPurpose: AUTH_LOGIN' }),
    )

    // `Proof` requires 64 and 128 hex characters. The Hub hands back
    // Uint8Arrays; nothing above the adapter should ever learn that.
    expect(signature.publicKey).toBe('ab'.repeat(32))
    expect(signature.signature).toBe('cd'.repeat(64))
    expect(signature.signer).toBe(WALLET)
  })

  it('accepts Hub keys already encoded as hex, not only Uint8Array', async () => {
    signMessage.mockResolvedValue({
      signer: WALLET,
      signerPublicKey: 'ab'.repeat(32),
      signature: 'cd'.repeat(64),
    })
    const transport = await loadTransport()

    await expect(
      transport.signChallenge(Promise.resolve({ wallet: WALLET, message: 'NIMPASS' })),
    ).resolves.toMatchObject({ publicKey: 'ab'.repeat(32), signature: 'cd'.repeat(64) })
  })

  it('signs the backend message verbatim, pinned to the challenge wallet', async () => {
    signMessage.mockResolvedValue(signedMessage())
    const transport = await loadTransport()
    const message = 'NIMPASS\nVersion: 1\nPurpose: AUTH_LOGIN\nNonce: abc'

    await transport.signChallenge(Promise.resolve({ wallet: WALLET, message }))

    const request = await signMessage.mock.calls[0]![0]
    expect(request).toEqual({ appName: 'Nimpass', signer: WALLET, message })
  })

  it('refuses a signature whose encoding does not fit the contract', async () => {
    signMessage.mockResolvedValue({
      signer: WALLET,
      signerPublicKey: new Uint8Array(8),
      signature: new Uint8Array(4),
    })
    const transport = await loadTransport()

    await expect(
      transport.signChallenge(Promise.resolve({ wallet: WALLET, message: 'x' })),
    ).rejects.toMatchObject({ kind: 'UNKNOWN' })
  })

  it('pays with checkout(), carrying the payment reference as exact UTF-8 bytes', async () => {
    checkout.mockResolvedValue({ hash: TX_HASH })
    const transport = await loadTransport()

    const hash = await transport.pay(
      Promise.resolve({
        recipient: 'NQ55 0000 0000 0000 0000 0000 0000 0000 0099',
        valueLuna: 25_000_000,
        data: REFERENCE,
        sender: WALLET,
      }),
    )

    expect(hash).toBe(TX_HASH)
    const request = await checkout.mock.calls[0]![0]

    expect(request.recipient).toBe('NQ55 0000 0000 0000 0000 0000 0000 0000 0099')
    expect(request.value).toBe(25_000_000)
    // The backend compares the transaction's recipient data with exactly these
    // bytes. Re-encoding the reference is how a paid purchase becomes an
    // unrecognised one (docs/05 §45).
    expect(new TextDecoder().decode(request.extraData)).toBe(REFERENCE)
  })

  it('forces the sender to the wallet the intent was issued for', async () => {
    checkout.mockResolvedValue({ hash: TX_HASH })
    const transport = await loadTransport()

    await transport.pay(
      Promise.resolve({
        recipient: 'NQ55 0000 0000 0000 0000 0000 0000 0000 0099',
        valueLuna: 1,
        data: REFERENCE,
        sender: WALLET,
      }),
    )

    // The backend rejects a transaction from any other sender, so the Hub is
    // asked to refuse rather than let the customer discover that after paying.
    const request = await checkout.mock.calls[0]![0]
    expect(request.sender).toBe(WALLET)
    expect(request.forceSender).toBe(true)
  })

  it('leaves fee, validity and flags to the wallet, as the payment spec requires', async () => {
    checkout.mockResolvedValue({ hash: TX_HASH })
    const transport = await loadTransport()

    await transport.pay(
      Promise.resolve({ recipient: 'NQ55', valueLuna: 1, data: REFERENCE, sender: WALLET }),
    )

    // docs/05 §29-§30: no hardcoded fee and no manual validity window. The
    // defaults are also what make this a basic transaction, which is the only
    // shape the backend's verification accepts.
    const request = await checkout.mock.calls[0]![0]
    expect(request.fee).toBeUndefined()
    expect(request.validityDuration).toBeUndefined()
    expect(request.flags).toBeUndefined()
    expect(request.recipientType).toBeUndefined()
  })

  it('refuses a checkout result that carries no usable transaction hash', async () => {
    // `checkout()` can resolve to `{ success: true }` for a version-2 request.
    // Nimpass only sends version 1, so a result with no hash means something
    // changed underneath — and there would be nothing for the backend to verify.
    checkout.mockResolvedValue({ success: true })
    const transport = await loadTransport()

    await expect(
      transport.pay(
        Promise.resolve({ recipient: 'NQ55', valueLuna: 1, data: REFERENCE, sender: WALLET }),
      ),
    ).rejects.toMatchObject({ kind: 'UNKNOWN' })
  })

  it('exposes no network readiness, rather than inventing one', async () => {
    // The Hub gives a calling site no consensus or block-height call. Answering
    // "ready" would be faking wallet state (docs/08-ARCHITECTURE.md §14).
    const transport = await loadTransport()
    expect(await transport.networkReadiness()).toBeNull()
  })
})

/**
 * The popup rule, asserted rather than assumed.
 *
 * "Call Hub methods synchronously within user actions to avoid popup blockers"
 * (https://nimiq.dev/hub/getting-started). Nimpass cannot know the challenge or
 * the purchase intent before the click, so it hands the Hub a *promise* — and
 * `HubApi` opens the window before awaiting its arguments. If the adapter ever
 * awaits first, the window opens outside the user activation and is blocked.
 */
describe('opening the window before the backend answers', () => {
  it('calls checkout() before the purchase intent resolves', async () => {
    checkout.mockResolvedValue({ hash: TX_HASH })
    const transport = await loadTransport()

    let releaseIntent: (value: {
      recipient: string
      valueLuna: number
      data: string
      sender: string
    }) => void = () => {}
    const intent = new Promise<{
      recipient: string
      valueLuna: number
      data: string
      sender: string
    }>((resolve) => {
      releaseIntent = resolve
    })

    const paying = transport.pay(intent)

    // The backend has not answered yet, and the Hub has already been called.
    expect(checkout).toHaveBeenCalledTimes(1)

    releaseIntent({ recipient: 'NQ55', valueLuna: 1, data: REFERENCE, sender: WALLET })
    expect(await paying).toBe(TX_HASH)
  })

  it('calls signMessage() before the challenge resolves', async () => {
    signMessage.mockResolvedValue(signedMessage())
    const transport = await loadTransport()

    let releaseChallenge: (value: { wallet: string; message: string }) => void = () => {}
    const challenge = new Promise<{ wallet: string; message: string }>((resolve) => {
      releaseChallenge = resolve
    })

    const signing = transport.signChallenge(challenge)

    expect(signMessage).toHaveBeenCalledTimes(1)

    releaseChallenge({ wallet: WALLET, message: 'NIMPASS' })
    await expect(signing).resolves.toMatchObject({ publicKey: 'ab'.repeat(32) })
  })
})

describe('Hub failures become safe application states', () => {
  it('reads the documented CANCELED as a cancellation, not a system failure', async () => {
    checkout.mockRejectedValue(new Error('CANCELED'))
    const transport = await loadTransport()

    await expect(
      transport.pay(
        Promise.resolve({ recipient: 'NQ55', valueLuna: 1, data: REFERENCE, sender: WALLET }),
      ),
    ).rejects.toMatchObject({ kind: 'USER_REJECTED' })
  })

  it('reads a closed Hub window as a cancellation too', async () => {
    signMessage.mockRejectedValue(new Error('Connection was closed'))
    const transport = await loadTransport()

    await expect(
      transport.signChallenge(Promise.resolve({ wallet: WALLET, message: 'x' })),
    ).rejects.toMatchObject({ kind: 'USER_REJECTED' })
  })

  it('separates a blocked pop-up from a cancellation, because the remedy differs', async () => {
    chooseAddress.mockRejectedValue(new Error('Failed to open popup'))
    const transport = await loadTransport()

    // The user allows pop-ups and tries again; telling them they cancelled
    // would send them looking for a problem that is not theirs.
    await expect(transport.requestAccount()).rejects.toMatchObject({ kind: 'POPUP_BLOCKED' })
  })

  it('maps the Hub request timeout onto the wallet-timeout state', async () => {
    signMessage.mockRejectedValue(new Error('REQUEST_TIMED_OUT'))
    const transport = await loadTransport()

    await expect(
      transport.signChallenge(Promise.resolve({ wallet: WALLET, message: 'x' })),
    ).rejects.toMatchObject({ kind: 'PROVIDER_TIMEOUT' })
  })

  it('never leaks a raw Hub payload into the user-facing message', async () => {
    checkout.mockRejectedValue(new Error('RpcError: postMessage to https://hub.internal:8443 failed'))
    const transport = await loadTransport()

    await transport
      .pay(Promise.resolve({ recipient: 'NQ55', valueLuna: 1, data: REFERENCE, sender: WALLET }))
      .then(
        () => expect.unreachable('checkout should have rejected'),
        (error: { message: string; cause?: unknown }) => {
          expect(error.message).not.toContain('hub.internal')
          expect(error.message).not.toContain('postMessage')
          expect(error.cause).toBeDefined()
        },
      )
  })

  it('treats a chooseAddress result with no address as "no accounts"', async () => {
    chooseAddress.mockResolvedValue({})
    const transport = await loadTransport()

    await expect(transport.requestAccount()).rejects.toMatchObject({ kind: 'NO_ACCOUNTS' })
  })
})
