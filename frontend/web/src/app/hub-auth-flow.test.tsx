import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authSessionRoutes, domainError, mockApi, ok } from '@/test/mock-api'
import { hubTransportDouble } from '@/test/wallet-transport'

/**
 * Desktop login: the same Nimpass authentication, through the Nimiq Hub.
 *
 * The property under test is that there is *one* authentication model. Every
 * step below is the one the Mini App runs — address, server challenge,
 * signature over that exact message, backend verification, backend-issued
 * session — and the only difference is that the Hub needs a user gesture per
 * window, so the flow pauses once in the middle (docs/09-SECURITY.md §12-§20).
 *
 * The Hub is doubled at the transport boundary; the backend is doubled at
 * `fetch`, so the real API client, envelope parsing and error mapping run.
 * Nothing here can produce a session that the stubbed backend did not issue.
 */

const chooseAddress = vi.fn()
const signMessage = vi.fn()
const currentTransportMock = vi.fn()
const initWalletRuntimeMock = vi.fn()

function desktopTransport() {
  return hubTransportDouble({
    chooseAddress: (...args: []) => chooseAddress(...args),
    signMessage: (...args: [{ wallet: string; message: string }]) => signMessage(...args),
  })
}

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    currentTransport: () => currentTransportMock(),
    initWalletRuntime: () => initWalletRuntimeMock(),
  }
})

const { SessionProvider } = await import('./session-provider')
const { useSession } = await import('@/hooks/use-session')
const { NimiqOperationError, nimiqError } = await import('@/lib/nimiq')

const WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081'

const CHALLENGE = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  purpose: 'AUTH_LOGIN',
  wallet: WALLET,
  message:
    'NIMPASS\nVersion: 1\nPurpose: AUTH_LOGIN\nChallenge: bbbb\nNonce: 7f3c\nWallet: NQ07…',
  expiresAt: '2099-01-01T00:00:00Z',
}

const SESSION = {
  identity: {
    id: 'cccccccc-0000-4000-8000-000000000001',
    wallet: WALLET,
    createdAt: '2026-01-01T00:00:00Z',
  },
  expiresAt: '2099-01-01T00:00:00Z',
  csrfToken: 'f'.repeat(64),
}

const SIGNED = {
  publicKey: 'ab'.repeat(32),
  signature: 'cd'.repeat(64),
  signer: WALLET,
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  )
}

const NO_SESSION_YET = () => authSessionRoutes(SESSION, CHALLENGE)

beforeEach(() => {
  chooseAddress.mockReset()
  signMessage.mockReset()
  currentTransportMock.mockReset()
  initWalletRuntimeMock.mockReset()
  chooseAddress.mockResolvedValue(WALLET)
  signMessage.mockResolvedValue(SIGNED)
  const transport = desktopTransport()
  currentTransportMock.mockReturnValue(transport)
  initWalletRuntimeMock.mockResolvedValue({
    transport,
    capabilities: {
      nimiqProviderAvailable: false,
      walletOperationsAvailable: true,
      insideNimiqPay: false,
      transport: 'hub',
      gesturePerOperation: true,
    },
    error: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Renders the hook and waits for session recovery to answer. */
async function signedOutSession() {
  const { result } = renderHook(() => useSession(), { wrapper })
  await waitFor(() => expect(result.current.isRecovering).toBe(false))
  return result
}

describe('desktop login through the Nimiq Hub', () => {
  it('pauses after choosing an address, because a second window needs a second click', async () => {
    const { calls } = mockApi({
      ...NO_SESSION_YET(),
      'POST /api/v1/auth/challenges': () => ok(CHALLENGE),
      'POST /api/v1/auth/sessions': () => ok(SESSION),
    })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })

    // The address is known and the challenge already exists — but nothing has
    // been signed, because that needs its own user gesture.
    expect(result.current.flow).toMatchObject({ kind: 'WALLET_SELECTED', wallet: WALLET })
    expect(signMessage).not.toHaveBeenCalled()
    expect(result.current.session).toBeNull()

    // The challenge is bound to the address the wallet named, exactly as in the
    // Mini App: `ChallengeInput` is `{ wallet }` and nothing else.
    expect(calls.find((c) => c.url === '/api/v1/auth/challenges')?.body).toEqual({ wallet: WALLET })
  })

  it('completes the same challenge on the second press, without re-choosing an address', async () => {
    mockApi(NO_SESSION_YET())

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })
    await act(async () => {
      await result.current.signIn()
    })

    expect(chooseAddress).toHaveBeenCalledTimes(1)
    expect(signMessage).toHaveBeenCalledTimes(1)
    expect(result.current.session).toEqual(SESSION)
    expect(result.current.flow).toMatchObject({ kind: 'AUTHENTICATED' })
  })

  it('signs the backend message verbatim and pins it to the chosen wallet', async () => {
    mockApi(NO_SESSION_YET())

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })
    await act(async () => {
      await result.current.signIn()
    })

    // Nimpass never composes the signed text: the nonce, the purpose and every
    // binding in it are the server's (docs/09 §14).
    expect(signMessage).toHaveBeenCalledWith({ wallet: WALLET, message: CHALLENGE.message })
  })

  it('declares the Hub signing scheme, so the backend verifies the right bytes', async () => {
    const { calls } = mockApi({
      ...NO_SESSION_YET(),
      'POST /api/v1/auth/challenges': () => ok(CHALLENGE),
      'POST /api/v1/auth/sessions': () => ok(SESSION),
    })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })
    await act(async () => {
      await result.current.signIn()
    })

    // The Hub signs its documented envelope rather than the raw message, and
    // the backend has to be told which of the two it is verifying. The wallet
    // is never trusted for anything else in this payload.
    expect(calls.find((c) => c.url === '/api/v1/auth/sessions')?.body).toEqual({
      challengeId: CHALLENGE.id,
      wallet: WALLET,
      publicKey: SIGNED.publicKey,
      signature: SIGNED.signature,
      signingScheme: 'hub',
    })
  })

  it('echoes the challenge wallet, not Hub’s spaced chooseAddress() spelling', async () => {
    // Hub returns the user-friendly 44-character form. The backend stores the
    // compact 36-character address on the challenge. Sending the Hub spelling
    // used to 400 as "Invalid proof fields" before signature verification.
    const hubAddress = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081'
    const compact = 'NQ0700000000000000000000000000000081'
    chooseAddress.mockResolvedValue(hubAddress)
    const compactChallenge = { ...CHALLENGE, wallet: compact }
    const { calls } = mockApi({
      ...NO_SESSION_YET(),
      'POST /api/v1/auth/challenges': () => ok(compactChallenge),
      'POST /api/v1/auth/sessions': () => ok(SESSION),
    })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })
    await act(async () => {
      await result.current.signIn()
    })

    expect(calls.find((c) => c.url === '/api/v1/auth/challenges')?.body).toEqual({ wallet: hubAddress })
    expect(calls.find((c) => c.url === '/api/v1/auth/sessions')?.body).toMatchObject({
      wallet: compact,
      signingScheme: 'hub',
    })
  })

  it('creates no session until the backend has verified the signature', async () => {
    let verified = false
    const routes = NO_SESSION_YET()
    const complete = routes['POST /api/v1/auth/sessions']
    mockApi({
      ...routes,
      'POST /api/v1/auth/sessions': () => {
        verified = true
        return complete()
      },
    })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })

    // A chosen address and a signed challenge are not an identity (§11, §19).
    expect(result.current.session).toBeNull()
    expect(verified).toBe(false)

    await act(async () => {
      await result.current.signIn()
    })
    expect(result.current.session).toEqual(SESSION)
  })

  it('never treats a rejected signature as authenticated', async () => {
    mockApi({
      ...NO_SESSION_YET(),
      'POST /api/v1/auth/challenges': () => ok(CHALLENGE),
      'POST /api/v1/auth/sessions': () =>
        domainError(401, 'INVALID_SIGNATURE', 'Wallet authentication failed.'),
    })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })
    await act(async () => {
      await result.current.signIn()
    })

    expect(result.current.session).toBeNull()
    expect(result.current.flow).toMatchObject({ kind: 'FAILED', reason: 'VERIFICATION_FAILED' })
  })
})

describe('when the Hub does not cooperate', () => {
  it('treats a dismissed Hub window as a cancellation the user can retry', async () => {
    chooseAddress.mockRejectedValue(new NimiqOperationError(nimiqError('USER_REJECTED')))
    mockApi({ ...NO_SESSION_YET(), 'POST /api/v1/auth/challenges': () => ok(CHALLENGE) })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })

    expect(result.current.flow).toEqual({ kind: 'CANCELLED' })
    expect(result.current.session).toBeNull()

    // The app is still usable: a fresh attempt runs the whole flow again.
    chooseAddress.mockResolvedValue(WALLET)
    mockApi(NO_SESSION_YET())
    await act(async () => {
      await result.current.signIn()
    })
    await act(async () => {
      await result.current.signIn()
    })
    expect(result.current.session).toEqual(SESSION)
  })

  it('reports a blocked pop-up as its own, retryable failure', async () => {
    chooseAddress.mockRejectedValue(new NimiqOperationError(nimiqError('POPUP_BLOCKED')))
    mockApi({ ...NO_SESSION_YET() })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })

    // Not "no wallet here": the wallet is fine, the browser refused the window,
    // and the user can fix that and press again.
    expect(result.current.flow).toMatchObject({ kind: 'FAILED', reason: 'POPUP_BLOCKED' })
  })

  it('surfaces a challenge the backend refused, without opening the signing window', async () => {
    mockApi({
      ...NO_SESSION_YET(),
      'POST /api/v1/auth/challenges': () => domainError(429, 'RATE_LIMITED', 'Too many challenges'),
    })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })

    expect(result.current.flow).toMatchObject({ kind: 'FAILED', reason: 'CHALLENGE_UNAVAILABLE' })
    expect(signMessage).not.toHaveBeenCalled()
  })

  it('abandons a paused attempt when the dialog is dismissed', async () => {
    mockApi({ ...NO_SESSION_YET(), 'POST /api/v1/auth/challenges': () => ok(CHALLENGE) })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })
    expect(result.current.flow).toMatchObject({ kind: 'WALLET_SELECTED' })

    act(() => {
      result.current.resetFlow()
    })

    // The held challenge is dropped rather than silently resumed later; it is
    // single-use and expires on its own TTL (docs/09 §16-§17).
    expect(result.current.flow).toEqual({ kind: 'IDLE' })

    mockApi({ ...NO_SESSION_YET(), 'POST /api/v1/auth/challenges': () => ok(CHALLENGE) })
    await act(async () => {
      await result.current.signIn()
    })
    expect(chooseAddress).toHaveBeenCalledTimes(2)
  })

  it('does not treat a still-loading Hub as a failed login', async () => {
    const transport = desktopTransport()
    currentTransportMock.mockReturnValue(null)
    initWalletRuntimeMock.mockImplementation(async () => {
      currentTransportMock.mockReturnValue(transport)
      return {
        transport,
        capabilities: {
          nimiqProviderAvailable: false,
          walletOperationsAvailable: true,
          insideNimiqPay: false,
          transport: 'hub',
          gesturePerOperation: true,
        },
        error: null,
      }
    })
    mockApi({ ...NO_SESSION_YET(), 'POST /api/v1/auth/challenges': () => ok(CHALLENGE) })

    const result = await signedOutSession()
    await act(async () => {
      await result.current.signIn()
    })

    // The click's popup permission was spent waiting. The wallet exists, so
    // this stays on Login rather than "Couldn't log you in".
    expect(result.current.flow.kind).toBe('IDLE')
    expect(result.current.session).toBeNull()
    expect(chooseAddress).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.signIn()
    })
    expect(result.current.flow).toMatchObject({ kind: 'WALLET_SELECTED', wallet: WALLET })
    expect(chooseAddress).toHaveBeenCalledTimes(1)
  })
})
