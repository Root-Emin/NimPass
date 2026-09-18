import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authSessionRoutes, domainError, mockApi, ok } from '@/test/mock-api'

/**
 * Wallet authentication, end to end across the two trust boundaries.
 *
 * Nimiq Pay is stubbed at the adapter boundary; the backend is stubbed at
 * `fetch`, so the real API client, envelope parsing and error mapping all run.
 *
 * The property under test throughout: a signature is not an authentication
 * result. Only the backend's verify response produces a session
 * (docs/09-SECURITY.md §11, §18, §19).
 */

const listAccounts = vi.fn()
const signMessage = vi.fn()

import { miniAppTransportDouble } from '@/test/wallet-transport'

vi.mock('@/lib/nimiq', async () => {
  const actual = await vi.importActual<typeof import('@/lib/nimiq')>('@/lib/nimiq')
  return {
    ...actual,
    // Stubbed at the transport boundary, on the Nimiq Pay side: one user action
    // carries account access and signing, with no popup budget to spend.
    currentTransport: () =>
      miniAppTransportDouble({
        listAccounts: (...args: unknown[]) => listAccounts(...args),
        signMessage: (...args: unknown[]) => signMessage(...args),
      }),
  }
})

const { SessionProvider } = await import('./session-provider')
const { useSession } = await import('@/hooks/use-session')
const { NimiqOperationError, nimiqError } = await import('@/lib/nimiq')

const WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081'

// Shaped as the `Challenge` schema: `{ id, purpose, wallet, message, expiresAt }`.
const CHALLENGE = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  purpose: 'AUTH_LOGIN',
  wallet: WALLET,
  message:
    'Nimpass Wallet Authentication\n\nAction: Sign in to Nimpass\nWallet: NQ07…\nChallenge: nonce-xyz',
  expiresAt: '2026-09-13T10:05:00Z',
}

// Shaped as the `Session` schema: identity, expiry and the CSRF token.
const SESSION = {
  identity: { id: 'cccccccc-0000-4000-8000-000000000001', wallet: WALLET, createdAt: '2026-01-01T00:00:00Z' },
  expiresAt: '2099-01-01T00:00:00Z',
  csrfToken: 'f'.repeat(64),
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

beforeEach(() => {
  listAccounts.mockReset()
  signMessage.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('wallet authentication', () => {
  it('runs account access → challenge → sign → verify and signs the server message verbatim', async () => {
    listAccounts.mockResolvedValue([WALLET])
    signMessage.mockResolvedValue({ publicKey: 'pk-hex', signature: 'sig-hex' })

    const { calls } = mockApi(authSessionRoutes(SESSION, CHALLENGE))

    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => expect(result.current.isRecovering).toBe(false))

    await act(async () => {
      await result.current.signIn()
    })
    if (result.current.flow.kind === 'WALLET_SELECTED') {
      await act(async () => { await result.current.signIn() })
    }

    // The frontend never composes the signed text.
    expect(signMessage).toHaveBeenCalledWith(CHALLENGE.message)

    const challengeCall = calls.find((c) => c.url === '/api/v1/auth/challenges')
    // `ChallengeInput` is `{ wallet }`; the schema forbids extra properties and
    // the purpose is fixed by the endpoint.
    expect(challengeCall?.body).toEqual({ wallet: WALLET })

    // Verification submits what the wallet produced, keyed to the challenge.
    const verifyCall = calls.find((c) => c.url === '/api/v1/auth/sessions')
    expect(verifyCall?.body).toEqual({
      challengeId: CHALLENGE.id,
      wallet: WALLET,
      publicKey: 'pk-hex',
      signature: 'sig-hex',
    })

    expect(result.current.session).toEqual(SESSION)
    expect(result.current.flow.kind).toBe('AUTHENTICATED')
  })

  it('asks for the account before the challenge, so the challenge is bound to it', async () => {
    const order: string[] = []
    listAccounts.mockImplementation(async () => {
      order.push('listAccounts')
      return [WALLET]
    })
    signMessage.mockImplementation(async () => {
      order.push('sign')
      return { publicKey: 'pk', signature: 'sig' }
    })

    let authed = false
    mockApi({
      'GET /api/v1/auth/session': () =>
        authed ? ok(SESSION) : domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
      'POST /api/v1/auth/challenges': () => {
        order.push('challenge')
        return ok(CHALLENGE)
      },
      'POST /api/v1/auth/sessions': () => {
        order.push('verify')
        authed = true
        return ok(SESSION)
      },
    })

    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => expect(result.current.isRecovering).toBe(false))
    await act(async () => {
      await result.current.signIn()
    })
    if (result.current.flow.kind === 'WALLET_SELECTED') {
      await act(async () => { await result.current.signIn() })
    }

    expect(order).toEqual(['listAccounts', 'challenge', 'sign', 'verify'])
  })

  it('treats a dismissed signing dialog as a cancellation, not a failure', async () => {
    listAccounts.mockResolvedValue([WALLET])
    signMessage.mockRejectedValue(new NimiqOperationError(nimiqError('USER_REJECTED')))

    mockApi(authSessionRoutes(SESSION, CHALLENGE))

    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => expect(result.current.isRecovering).toBe(false))
    await act(async () => {
      await result.current.signIn()
    })
    if (result.current.flow.kind === 'WALLET_SELECTED') {
      await act(async () => { await result.current.signIn() })
    }

    expect(result.current.flow.kind).toBe('CANCELLED')
    expect(result.current.session).toBeNull()
  })

  it('treats a dismissed account dialog as a cancellation too', async () => {
    listAccounts.mockRejectedValue(new NimiqOperationError(nimiqError('USER_REJECTED')))
    mockApi({ 'GET /api/v1/auth/session': () => domainError(401, 'AUTH_REQUIRED', 'Authentication required') })

    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => expect(result.current.isRecovering).toBe(false))
    await act(async () => {
      await result.current.signIn()
    })
    if (result.current.flow.kind === 'WALLET_SELECTED') {
      await act(async () => { await result.current.signIn() })
    }

    expect(result.current.flow.kind).toBe('CANCELLED')
    expect(signMessage).not.toHaveBeenCalled()
  })

  it('reports an expired challenge distinctly so the user can simply retry', async () => {
    listAccounts.mockResolvedValue([WALLET])
    signMessage.mockResolvedValue({ publicKey: 'pk', signature: 'sig' })

    mockApi({
      'GET /api/v1/auth/session': () => domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
      'POST /api/v1/auth/challenges': () => ok(CHALLENGE),
      'POST /api/v1/auth/sessions': () => domainError(400, 'CHALLENGE_EXPIRED', 'expired'),
    })

    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => expect(result.current.isRecovering).toBe(false))
    await act(async () => {
      await result.current.signIn()
    })
    if (result.current.flow.kind === 'WALLET_SELECTED') {
      await act(async () => { await result.current.signIn() })
    }

    expect(result.current.flow).toMatchObject({ kind: 'FAILED', reason: 'CHALLENGE_EXPIRED' })
    expect(result.current.session).toBeNull()
  })

  it('never creates a session when verification fails, even with a valid signature', async () => {
    listAccounts.mockResolvedValue([WALLET])
    signMessage.mockResolvedValue({ publicKey: 'pk', signature: 'sig' })

    mockApi({
      'GET /api/v1/auth/session': () => domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
      'POST /api/v1/auth/challenges': () => ok(CHALLENGE),
      'POST /api/v1/auth/sessions': () => domainError(401, 'UNAUTHORIZED', 'signature mismatch'),
    })

    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => expect(result.current.isRecovering).toBe(false))
    await act(async () => {
      await result.current.signIn()
    })
    if (result.current.flow.kind === 'WALLET_SELECTED') {
      await act(async () => { await result.current.signIn() })
    }

    expect(result.current.session).toBeNull()
    expect(result.current.flow).toMatchObject({ kind: 'FAILED', reason: 'VERIFICATION_FAILED' })
  })

  it('blames the signature, not the browser, when the backend rejects the proof', async () => {
    // Both a rejected proof and a dropped session cookie answer 401, and the
    // two were once reported with the same "your signature was accepted, but
    // the browser did not keep the session cookie" copy. Inside Nimiq Pay that
    // sent a real user to hunt for a cookie setting while the wallet's
    // signature was the thing being refused. The proof failure must never
    // claim the signature was accepted.
    listAccounts.mockResolvedValue([WALLET])
    signMessage.mockResolvedValue({ publicKey: 'pk', signature: 'sig' })

    mockApi({
      'GET /api/v1/auth/session': () => domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
      'POST /api/v1/auth/challenges': () => ok(CHALLENGE),
      'POST /api/v1/auth/sessions': () => domainError(401, 'INVALID_SIGNATURE', 'Wallet signature invalid'),
    })

    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => expect(result.current.isRecovering).toBe(false))
    await act(async () => { await result.current.signIn() })
    if (result.current.flow.kind === 'WALLET_SELECTED') {
      await act(async () => { await result.current.signIn() })
    }

    expect(result.current.session).toBeNull()
    const flow = result.current.flow
    expect(flow).toMatchObject({ kind: 'FAILED', reason: 'VERIFICATION_FAILED' })
    const message = flow.kind === 'FAILED' ? flow.message : ''
    expect(message).not.toContain('cookie')
    expect(message).not.toContain('accepted')
    expect(message).toContain('could not verify that signature')
  })

  it('recovers an existing session on boot without touching the wallet', async () => {
    mockApi({ 'GET /api/v1/auth/session': () => ok(SESSION) })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => expect(result.current.session).toEqual(SESSION))
    // Session recovery must not open a native dialog on page load.
    expect(listAccounts).not.toHaveBeenCalled()
    expect(signMessage).not.toHaveBeenCalled()
  })

  it('treats an unauthenticated visitor as a normal state, not an error', async () => {
    mockApi({ 'GET /api/v1/auth/session': () => domainError(401, 'AUTH_REQUIRED', 'Authentication required') })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => expect(result.current.isRecovering).toBe(false))
    expect(result.current.session).toBeNull()
    expect(result.current.flow.kind).toBe('IDLE')
  })

  it('keeps the session when server-side logout cannot be confirmed', async () => {
    mockApi({
      'GET /api/v1/auth/session': () => ok(SESSION),
      'DELETE /api/v1/auth/session': () => {
        throw new TypeError('Failed to fetch')
      },
    })

    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => expect(result.current.session).toEqual(SESSION))

    await act(async () => {
      try {
        await result.current.signOut()
      } catch {
        /* Logout could not be confirmed; the session stays. */
      }
    })
    expect(result.current.session).toEqual(SESSION)
  })

  it('will not start a second sign-in while one is in flight', async () => {
    let releaseAccounts: ((value: string[]) => void) | undefined
    listAccounts.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          releaseAccounts = resolve
        }),
    )

    mockApi(authSessionRoutes(SESSION, CHALLENGE))

    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => expect(result.current.isRecovering).toBe(false))

    await act(async () => {
      const first = result.current.signIn()
      const second = result.current.signIn()
      releaseAccounts?.([WALLET])
      await Promise.all([first, second])
    })

    // Stacking native approval sheets breaks informed consent (docs/04 §24).
    expect(listAccounts).toHaveBeenCalledTimes(1)
  })
})


it('recovers a session cookie that was missing on the first read after proof', async () => {
  listAccounts.mockResolvedValue([WALLET])
  signMessage.mockResolvedValue({ publicKey: 'pk-hex', signature: 'sig-hex' })
  let sessionReads = 0
  mockApi({
    'GET /api/v1/auth/session': () => {
      sessionReads += 1
      return sessionReads <= 2
        ? domainError(401, 'AUTH_REQUIRED', 'Authentication required')
        : ok(SESSION)
    },
    'POST /api/v1/auth/challenges': () => ok(CHALLENGE),
    'POST /api/v1/auth/sessions': () => ok(SESSION),
  })
  const { result } = renderHook(() => useSession(), { wrapper })
  await waitFor(() => expect(result.current.isRecovering).toBe(false))
  await act(async () => {
    await result.current.signIn()
  })
  if (result.current.flow.kind === 'WALLET_SELECTED') {
    await act(async () => {
      await result.current.signIn()
    })
  }
  expect(result.current.session).toEqual(SESSION)
  expect(result.current.flow.kind).toBe('AUTHENTICATED')
})

it('does not unlock private areas when proof succeeds but the cookie is missing', async () => {
  listAccounts.mockResolvedValue([WALLET])
  signMessage.mockResolvedValue({ publicKey: 'pk', signature: 'sig' })
  mockApi({
    'GET /api/v1/auth/session': () => domainError(401, 'AUTH_REQUIRED'),
    'POST /api/v1/auth/challenges': () => ok(CHALLENGE),
    'POST /api/v1/auth/sessions': () => ok(SESSION),
  })
  const { result } = renderHook(() => useSession(), { wrapper })
  await waitFor(() => expect(result.current.isRecovering).toBe(false))
  await act(async () => { await result.current.signIn() })
  expect(result.current.flow.kind).toBe('WALLET_SELECTED')
  expect(signMessage).not.toHaveBeenCalled()
  await act(async () => { await result.current.signIn() })
  expect(result.current.session).toBeNull()
  expect(result.current.flow).toMatchObject({ kind: 'FAILED', message: expect.stringContaining('cookie') })
})
