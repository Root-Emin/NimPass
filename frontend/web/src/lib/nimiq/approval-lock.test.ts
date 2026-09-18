import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Native approval sheets must never stack.
 *
 * `listAccounts`, `sign` and the `send*` methods each open a Nimiq Pay
 * confirmation the Mini App cannot dismiss or inspect. Two open at once means
 * the user is approving something they cannot identify, which is a consent
 * failure before it is a UX one (docs/04-NIMIQ-MINI-APPS.md §24, §56).
 *
 * Per-flow guards cannot cover this: signing in from the header while a
 * purchase waits for approval crosses two independent flows. The lock belongs
 * at the adapter, which is what these tests pin down.
 */

const init = vi.fn()
vi.mock('@nimiq/mini-app-sdk', () => ({ init: (...args: unknown[]) => init(...args) }))

/** A provider whose approval-requiring calls stay pending until released. */
function pendingProvider() {
  const release: Record<string, (value: unknown) => void> = {}
  const pending = (name: string) => () =>
    new Promise((resolve) => {
      release[name] = resolve
    })

  return {
    release,
    provider: {
      listAccounts: vi.fn(pending('listAccounts')),
      sign: vi.fn(pending('sign')),
      isConsensusEstablished: vi.fn(async () => true),
      getBlockNumber: vi.fn(async () => 1),
      sendBasicTransaction: vi.fn(pending('sendBasicTransaction')),
      sendBasicTransactionWithData: vi.fn(pending('sendBasicTransactionWithData')),
    },
  }
}

async function loadAdapter() {
  const adapter = await import('./client')
  adapter.resetNimiq()
  return adapter
}

beforeEach(() => {
  vi.resetModules()
  init.mockReset()
})

afterEach(() => {
  Reflect.deleteProperty(window, 'nimiqPay')
})

describe('native approval serialisation', () => {
  it('refuses a payment while a sign-in dialog is still open', async () => {
    const { provider, release } = pendingProvider()
    init.mockResolvedValue(provider)

    const { initNimiq, listAccounts, sendBasicTransactionWithData } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    // Sign-in opens the account sheet and the user has not answered it.
    const accounts = listAccounts()
    await Promise.resolve()

    // Meanwhile the customer presses Buy on the pass page.
    await expect(
      sendBasicTransactionWithData({ recipient: 'NQ07', value: 1, data: 'NP:x' }),
    ).rejects.toMatchObject({ kind: 'WALLET_BUSY' })

    // The second request never reached the wallet, so no second sheet appeared.
    expect(provider.sendBasicTransactionWithData).not.toHaveBeenCalled()

    release.listAccounts?.(['NQ07 0000 0000 0000 0000 0000 0000 0000 0081'])
    await expect(accounts).resolves.toHaveLength(1)
  })

  it('releases the lock once the first approval settles', async () => {
    const { provider, release } = pendingProvider()
    init.mockResolvedValue(provider)

    const { initNimiq, listAccounts, signMessage } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    const first = listAccounts()
    await Promise.resolve()
    release.listAccounts?.(['NQ07'])
    await first

    // The next approval is a normal, separate user action and must go through.
    const second = signMessage('Nimpass Wallet Authentication\n\nChallenge: abc')
    await Promise.resolve()
    release.sign?.({ publicKey: 'pk', signature: 'sig' })

    await expect(second).resolves.toEqual({ publicKey: 'pk', signature: 'sig' })
    expect(provider.sign).toHaveBeenCalledTimes(1)
  })

  it('releases the lock when the user rejects the first dialog', async () => {
    init.mockResolvedValue({
      listAccounts: vi.fn(async () => {
        throw Object.assign(new Error('denied'), { name: 'PermissionDeniedError' })
      }),
      sign: vi.fn(async () => ({ publicKey: 'pk', signature: 'sig' })),
      isConsensusEstablished: vi.fn(async () => true),
      getBlockNumber: vi.fn(async () => 1),
      sendBasicTransaction: vi.fn(),
      sendBasicTransactionWithData: vi.fn(),
    })

    const { initNimiq, listAccounts, signMessage } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    // Cancelling is a normal outcome; it must not wedge the wallet shut.
    await expect(listAccounts()).rejects.toMatchObject({ kind: 'USER_REJECTED' })
    await expect(signMessage('msg')).resolves.toEqual({ publicKey: 'pk', signature: 'sig' })
  })

  it('leaves read-only calls unlocked', async () => {
    const { provider, release } = pendingProvider()
    init.mockResolvedValue(provider)

    const { initNimiq, listAccounts, getNetworkReadiness } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    const accounts = listAccounts()
    await Promise.resolve()

    // `isConsensusEstablished` and `getBlockNumber` open no dialog, so the
    // payment pre-flight must not be blocked by an unrelated approval.
    await expect(getNetworkReadiness()).resolves.toEqual({
      consensusEstablished: true,
      blockNumber: 1,
    })

    release.listAccounts?.([])
    await accounts.catch(() => {})
  })

  /*
   * Redemption signing joins the same queue (§45 of Milestone 4B).
   *
   * Three things now open native dialogs — sign-in, payment and redemption
   * authorisation — and they run on the same screens minutes apart. Stacked
   * approval sheets destroy informed consent: a customer who is shown two
   * prompts cannot tell which one they are answering, and the one they dismiss
   * is not necessarily the one they meant to.
   */
  it('refuses a redemption signature while a payment approval is open', async () => {
    const { provider, release } = pendingProvider()
    init.mockResolvedValue(provider)

    const { initNimiq, sendBasicTransactionWithData, signMessage } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    // A payment sheet is open and unanswered.
    const payment = sendBasicTransactionWithData({ recipient: 'NQ07', value: 1, data: 'NP1:x' })
    await Promise.resolve()

    // The customer opens a pass in another tab and tries to redeem.
    await expect(signMessage('NIMPASS\nPurpose: AUTHORIZE_REDEMPTION')).rejects.toMatchObject({
      kind: 'WALLET_BUSY',
    })
    expect(provider.sign).not.toHaveBeenCalled()

    release.sendBasicTransactionWithData?.('a'.repeat(64))
    await expect(payment).resolves.toHaveLength(64)
  })

  it('refuses a payment while a redemption signature is open', async () => {
    // The same rule in the other direction: whichever dialog opened first owns
    // the wallet until the user answers it.
    const { provider, release } = pendingProvider()
    init.mockResolvedValue(provider)

    const { initNimiq, sendBasicTransactionWithData, signMessage } = await loadAdapter()
    await initNimiq({ timeoutMs: 50 })

    const signing = signMessage('NIMPASS\nPurpose: AUTHORIZE_REDEMPTION')
    await Promise.resolve()

    await expect(
      sendBasicTransactionWithData({ recipient: 'NQ07', value: 1, data: 'NP1:x' }),
    ).rejects.toMatchObject({ kind: 'WALLET_BUSY' })
    expect(provider.sendBasicTransactionWithData).not.toHaveBeenCalled()

    release.sign?.({ publicKey: 'ab'.repeat(32), signature: 'cd'.repeat(64) })
    await expect(signing).resolves.toMatchObject({ publicKey: 'ab'.repeat(32) })
  })
})
