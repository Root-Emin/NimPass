import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, authApi, messageForApiError, providerApi, packagesApi, providersApi, purchasesApi, passesApi } from '@/api'
import { mockApi, ok, domainError, aProvider, aService, aPackage, anOffer } from '@/test/mock-api'
import { aPass, aPurchase } from '@/test/fixtures'

/**
 * Frontend ↔ Mission 02 contract tests.
 *
 * Every assertion here is checkable against `backend/openapi.yaml`: the path,
 * the method, the request body's exact properties, and the response fields the
 * app reads back.
 *
 * They exist because a drift between these two is silent. The types catch a
 * renamed field, but nothing catches a wrong path, a body with one extra key
 * (every input schema is `additionalProperties: false`, so an extra key is a
 * 400) or a response the app happens not to read.
 */

const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'
const SERVICE_ID = '00000000-0000-4000-8000-000000000003'
const PACKAGE_ID = '00000000-0000-4000-8000-000000000004'
const CHALLENGE_ID = 'bbbbbbbb-0000-4000-8000-000000000001'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Awaits a rejection and returns it typed, so assertions stay readable. */
async function captureApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    return error as ApiError
  }
  throw new Error('Expected the request to reject')
}

const CHALLENGE = {
  id: CHALLENGE_ID,
  purpose: 'AUTH_LOGIN',
  wallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
  message: 'Nimpass Wallet Authentication\n\nChallenge: nonce',
  expiresAt: '2026-09-13T10:05:00Z',
}

const SESSION = {
  identity: {
    id: 'cccccccc-0000-4000-8000-000000000001',
    wallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
    createdAt: '2026-01-01T00:00:00Z',
  },
  expiresAt: '2099-01-01T00:00:00Z',
  csrfToken: 'f'.repeat(64),
}

describe('auth contract', () => {
  it('asks for a challenge with only { wallet }', async () => {
    const { calls } = mockApi({ 'POST /api/v1/auth/challenges': () => ok(CHALLENGE, 201) })

    const challenge = await authApi.requestAuthChallenge({ wallet: CHALLENGE.wallet })

    const call = calls[0]!
    expect(call.url).toBe('/api/v1/auth/challenges')
    // `ChallengeInput` is additionalProperties:false — an extra key is a 400.
    expect(call.body).toEqual({ wallet: CHALLENGE.wallet })

    // The response is read as `Challenge`: id, not challengeId.
    expect(challenge.id).toBe(CHALLENGE_ID)
    expect(challenge.message).toBe(CHALLENGE.message)
  })

  it('submits a Proof with exactly the four documented fields', async () => {
    const { calls } = mockApi({ 'POST /api/v1/auth/sessions': () => ok(SESSION, 201) })

    const session = await authApi.verifyAuthSignature({
      challengeId: CHALLENGE_ID,
      wallet: CHALLENGE.wallet,
      publicKey: 'ab'.repeat(32),
      signature: 'cd'.repeat(64),
    })

    expect(calls[0]!.body).toEqual({
      challengeId: CHALLENGE_ID,
      wallet: CHALLENGE.wallet,
      publicKey: 'ab'.repeat(32),
      signature: 'cd'.repeat(64),
    })

    // `Session` is nested identity plus the CSRF token.
    expect(session.identity.wallet).toBe(CHALLENGE.wallet)
    expect(session.csrfToken).toHaveLength(64)
  })

  it('passes the wallet signature through unchanged', async () => {
    const { calls } = mockApi({ 'POST /api/v1/auth/sessions': () => ok(SESSION, 201) })

    // Whether Nimiq Pay's sign() output interoperates with the backend's
    // Ed25519 verification is unverified on a real device. Re-encoding here
    // would hide that rather than settle it, so the bytes are forwarded as-is.
    const publicKey = 'AbCdEf'.padEnd(64, '0')
    const signature = 'FfEeDd'.padEnd(128, '0')
    await authApi.verifyAuthSignature({
      challengeId: CHALLENGE_ID,
      wallet: CHALLENGE.wallet,
      publicKey,
      signature,
    })

    const body = calls[0]!.body as { publicKey: string; signature: string }
    expect(body.publicKey).toBe(publicKey)
    expect(body.signature).toBe(signature)
  })

  it('logs out with DELETE and no body', async () => {
    const { calls } = mockApi({
      'DELETE /api/v1/auth/session': () => new Response(null, { status: 204 }),
    })

    await expect(authApi.logout()).resolves.toBeUndefined()
    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.body).toBeUndefined()
  })
})

describe('provider contract', () => {
  it('creates and updates a provider with only { name }', async () => {
    const { calls } = mockApi({
      'POST /api/v1/providers': () => ok(aProvider(), 201),
      [`PATCH /api/v1/providers/${PROVIDER_ID}`]: () => ok(aProvider()),
    })

    await providerApi.createProvider({ name: 'Alex Fitness' })
    await providerApi.updateMyProviderProfile(PROVIDER_ID, { name: 'Alex Fitness' })

    // `ProviderInput` is `{ name }`. Payout fields cannot be mass-assigned, so
    // the profile call must not carry them (docs/09-SECURITY.md §39).
    for (const call of calls) {
      expect(call.body).toEqual({ name: 'Alex Fitness' })
      expect(call.body).not.toHaveProperty('payoutWallet')
      expect(call.body).not.toHaveProperty('payoutVerifiedAt')
    }
  })

  it('reads payout verification from payoutVerifiedAt', async () => {
    mockApi({
      '/api/v1/providers': () =>
        ok({ items: [aProvider({ payoutVerifiedAt: null })] }),
    })

    const { items } = await providerApi.listMyProviders()
    expect(items[0]!.payoutVerifiedAt).toBeNull()
  })

  it('sends both signatures when verifying a payout wallet', async () => {
    const { calls } = mockApi({
      [`POST /api/v1/providers/${PROVIDER_ID}/payout-challenges`]: () => ok(CHALLENGE, 201),
      [`POST /api/v1/providers/${PROVIDER_ID}/payout-verifications`]: () => ok(aProvider()),
    })

    await providerApi.createPayoutChallenge(PROVIDER_ID, { wallet: 'NQ11' })
    await providerApi.verifyPayoutWallet(PROVIDER_ID, {
      challengeId: CHALLENGE_ID,
      wallet: 'NQ11',
      publicKey: 'a'.repeat(64),
      signature: 'b'.repeat(128),
      ownerPublicKey: 'c'.repeat(64),
      ownerSignature: 'd'.repeat(128),
    })

    expect(calls[0]!.body).toEqual({ wallet: 'NQ11' })

    // `PayoutProof` requires six fields: one signature proves control of the
    // destination, the other proves the account holder asked for the change
    // (docs/09-SECURITY.md §21-§23).
    expect(calls[1]!.body).toEqual({
      challengeId: CHALLENGE_ID,
      wallet: 'NQ11',
      publicKey: 'a'.repeat(64),
      signature: 'b'.repeat(128),
      ownerPublicKey: 'c'.repeat(64),
      ownerSignature: 'd'.repeat(128),
    })
  })
})

describe('service contract', () => {
  it('creates with ServiceInput and updates with ServiceUpdate', async () => {
    const { calls } = mockApi({
      [`POST /api/v1/providers/${PROVIDER_ID}/services`]: () => ok(aService(), 201),
      [`PATCH /api/v1/services/${SERVICE_ID}`]: () => ok(aService()),
    })

    await providerApi.createService(PROVIDER_ID, { name: 'Personal Training' })
    await providerApi.updateService(SERVICE_ID, {
      name: 'Personal Training',
      description: 'One-to-one.',
      status: 'ACTIVE',
    })

    // Create takes name (+ optional description) and no status.
    expect(calls[0]!.body).toEqual({ name: 'Personal Training' })

    // Update is a full replacement and requires status.
    expect(calls[1]!.body).toEqual({
      name: 'Personal Training',
      description: 'One-to-one.',
      status: 'ACTIVE',
    })
  })
})

describe('package contract', () => {
  it('creates a package under provider + service with PackageInput', async () => {
    const { calls } = mockApi({
      [`POST /api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/packages`]: () =>
        ok(aPackage(), 201),
    })

    await providerApi.createPackage(PROVIDER_ID, SERVICE_ID, {
      title: '10 Sessions',
      sessions: 10,
      priceLuna: 25_000_000,
      expirationAt: null,
    })

    const call = calls[0]!
    expect(call.url).toBe(`/api/v1/providers/${PROVIDER_ID}/services/${SERVICE_ID}/packages`)
    expect(call.body).toEqual({
      title: '10 Sessions',
      sessions: 10,
      priceLuna: 25_000_000,
      expirationAt: null,
    })

    // Integer Luna only; the spec forbids floating-point NIM on the wire.
    const body = call.body as { priceLuna: number }
    expect(Number.isInteger(body.priceLuna)).toBe(true)
  })

  it('publishes with POST and an empty body', async () => {
    const { calls } = mockApi({
      [`POST /api/v1/packages/${PACKAGE_ID}/publish`]: () => ok(aPackage()),
    })

    await providerApi.publishPackage(PACKAGE_ID)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.body).toBeUndefined()
  })

  it('surfaces a publish rejection rather than bypassing it', async () => {
    mockApi({
      [`POST /api/v1/packages/${PACKAGE_ID}/publish`]: () =>
        domainError(409, 'CONFLICT', 'payout wallet not verified'),
    })

    // Publishing needs an active service and a verified payout wallet. The
    // backend decides; the frontend reports (docs/08-ARCHITECTURE.md §147).
    await expect(providerApi.publishPackage(PACKAGE_ID)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })
})

describe('public discovery contract', () => {
  it('reads PublicOffer from the two package endpoints', async () => {
    const offer = anOffer()
    mockApi({
      '/api/v1/public/packages': () => ok({ items: [offer] }),
      [`/api/v1/public/packages/${offer.package.id}`]: () => ok(offer),
    })

    const list = await packagesApi.listPublicPackages()
    expect(list.items[0]!.package.sessions).toBe(10)
    expect(list.items[0]!.provider.name).toBe('Alex Fitness')
    expect(list.items[0]!.service.name).toBe('Personal Training')

    const single = await packagesApi.getPublicPackage(offer.package.id)
    expect(single.package.id).toBe(offer.package.id)
  })

  it('reads the public provider as identity only', async () => {
    mockApi({
      [`/api/v1/public/providers/${PROVIDER_ID}`]: () =>
        ok({ id: PROVIDER_ID, name: 'Alex Fitness' }),
    })

    const provider = await providersApi.getPublicProvider(PROVIDER_ID)
    // `PublicProvider` is `{ id, name }` — nothing else is available to render.
    expect(Object.keys(provider).sort()).toEqual(['id', 'name'])
  })

  it('sends no query parameters, because the contract defines none', async () => {
    const { calls } = mockApi({ '/api/v1/public/packages': () => ok({ items: [] }) })

    await packagesApi.listPublicPackages()
    expect(calls[0]!.url).toBe('/api/v1/public/packages')
  })
})

describe('purchase and pass contract', () => {
  const PURCHASE_ID = aPurchase().purchaseIntentId

  it('creates an intent with only { packageId } and an Idempotency-Key', async () => {
    const { calls, fetchMock } = mockApi({
      'POST /api/v1/purchases': () => ok(aPurchase(), 201),
    })

    await purchasesApi.createPurchaseIntent(
      { packageId: PACKAGE_ID },
      { idempotencyKey: 'attempt-1' },
    )

    expect(calls[0]!.body).toEqual({ packageId: PACKAGE_ID })

    const init = fetchMock.mock.calls[0]![1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('attempt-1')
  })

  it('submits a transaction candidate as { txHash } to /transactions', async () => {
    const { calls } = mockApi({
      [`POST /api/v1/purchases/${PURCHASE_ID}/transactions`]: () =>
        ok(aPurchase({ status: 'verifying' }), 202),
    })

    await purchasesApi.submitTransaction(PURCHASE_ID, { txHash: 'a'.repeat(64) })

    expect(calls[0]!.url).toBe(`/api/v1/purchases/${PURCHASE_ID}/transactions`)
    expect(calls[0]!.body).toEqual({ txHash: 'a'.repeat(64) })
  })

  it('reads the server-authored payment request without altering it', async () => {
    const purchase = aPurchase()
    mockApi({ [`/api/v1/purchases/${PURCHASE_ID}`]: () => ok(purchase) })

    const result = await purchasesApi.getPurchase(PURCHASE_ID)
    expect(result.paymentRequest).toEqual(purchase.paymentRequest)
    expect(result.paymentRequest!.data).toMatch(/^NP1:[0-9a-f]{32}$/)
  })

  it('reads a Pass with the contract session field names', async () => {
    const pass = aPass()
    mockApi({ [`/api/v1/passes/${pass.id}`]: () => ok(pass) })

    const result = await passesApi.getPass(pass.id)
    expect(result.originalSessions).toBe(10)
    expect(result.usedSessions).toBe(3)
    expect(result.remainingSessions).toBe(7)
  })
})

describe('error contract', () => {
  it.each([
    ['AUTH_REQUIRED', 401],
    ['CSRF_INVALID', 403],
    ['FORBIDDEN', 403],
    ['VALIDATION_ERROR', 400],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['PAYMENT_CONFLICT', 409],
    ['INTENT_EXPIRED', 410],
    ['RATE_LIMITED', 429],
    ['CHALLENGE_EXPIRED', 410],
    ['CHALLENGE_CONSUMED', 409],
    ['INVALID_SIGNATURE', 401],
    ['ORIGIN_FORBIDDEN', 403],
  ])('gives %s human copy rather than the server sentence', async (code, status) => {
    mockApi({ '/api/v1/providers': () => domainError(status, code, 'raw backend sentence') })

    const error = await captureApiError(providerApi.listMyProviders())
    expect(error.code).toBe(code)

    // Every code the spec lists is translated. "Not authorized" and "Invalid
    // state transition" are developer language (docs/02-USER-FLOWS.md §99).
    const message = messageForApiError(error)
    expect(message).not.toBe('raw backend sentence')
    expect(message.length).toBeGreaterThan(0)
  })

  it('treats 401 and 403 as different questions', async () => {
    mockApi({
      '/api/v1/providers': () => domainError(401, 'AUTH_REQUIRED', 'x'),
    })
    const unauthorized = await captureApiError(providerApi.listMyProviders())
    expect(unauthorized.isUnauthorized).toBe(true)
    expect(unauthorized.isForbidden).toBe(false)

    vi.unstubAllGlobals()
    mockApi({ '/api/v1/providers': () => domainError(403, 'FORBIDDEN', 'x') })
    const forbidden = await captureApiError(providerApi.listMyProviders())
    // Authentication succeeded; authorisation did not (docs/09-SECURITY.md §67).
    expect(forbidden.isForbidden).toBe(true)
    expect(forbidden.isUnauthorized).toBe(false)
  })

  it('reads the error envelope the spec defines', async () => {
    mockApi({ '/api/v1/providers': () => domainError(409, 'CONFLICT', 'nope') })

    const error = await captureApiError(providerApi.listMyProviders())
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    expect(error.isDomainError).toBe(true)
  })
})
