import { vi } from 'vitest'

import type { Pass, Provider, PublicPass, PublicProvider, Purchase, Service } from '@/types/domain'

/**
 * Stubs `fetch` with a small route table so tests exercise the real API client,
 * envelope parsing and error mapping rather than mocking the API modules away.
 */
type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>

/** Routes that keep the intent payable until a hash is submitted. */
export function livePurchaseRoutes(
  offer: PublicPass,
  intent: Purchase,
  options: {
    txHash?: string
    afterBroadcast?: () => unknown
    submit?: () => Response | Promise<Response>
    extra?: Record<string, Handler>
  } = {},
): Record<string, Handler> {
  let broadcast = false
  const id = intent.purchaseIntentId
  const txHash = options.txHash ?? 'a1b2c3d4'.repeat(8)
  const paid = () =>
    options.afterBroadcast?.() ?? {
      ...intent,
      status: 'verifying',
      paymentRequest: null,
      transactionHash: txHash,
    }
  return {
    [`/api/v1/public/passes/${offer.pass.id}`]: () => ok(offer),
    'POST /api/v1/purchases': () => ok(intent),
    [`POST /api/v1/purchases/${id}/wallet-attempts`]: () => ok(intent, 201),
    [`POST /api/v1/purchases/${id}/transactions`]: async () => {
      broadcast = true
      if (options.submit) return options.submit()
      return ok(paid())
    },
    [`GET /api/v1/purchases/${id}`]: () => ok(broadcast ? paid() : intent),
    ...options.extra,
  }
}

export function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; body: unknown }[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.href)
    const method = init?.method ?? 'GET'
    calls.push({
      method,
      url: `${url.pathname}${url.search}`,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })

    const handler = routes[`${method} ${url.pathname}`] ?? routes[url.pathname]
    if (!handler) {
      if (method === 'GET' && url.pathname === '/api/v1/public/config') {
        return ok({ network: 'TESTNET', environment: 'test' })
      }
      if (method === 'POST' && /\/purchases\/[^/]+\/wallet-attempts$/.test(url.pathname)) {
        return ok(
          {
            purchaseIntentId: url.pathname.split('/')[4],
            status: 'awaiting_payment',
            purchaseStatus: 'CREATED',
            passId: '00000000-0000-4000-8000-000000000004',
            passTitle: '10 Personal Training Sessions',
            serviceId: '00000000-0000-4000-8000-000000000003',
            providerId: '00000000-0000-4000-8000-000000000002',
            sessions: 10,
            priceLuna: 25_000_000,
            customerWallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
            createdAt: '2026-09-13T10:00:00Z',
            expiresAt: '2099-01-01T00:00:00Z',
            transactionHash: null,
            broadcastObservedAt: null,
            paymentVerification: null,
            failureCategory: null,
            purchasedPassId: null,
            compensation: null,
            paymentRequest: {
              recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
              valueLuna: 25_000_000,
              data: 'NP1:0123456789abcdef0123456789abcdef',
              network: 'TESTNET',
              expiresAt: '2099-01-01T00:00:00Z',
            },
          },
          201,
        )
      }
      if (method === 'POST' && /\/wallet-attempts\/[^/]+\/release$/.test(url.pathname)) {
        return noContent()
      }
      throw new TypeError(`Failed to fetch: no stub for ${method} ${url.pathname}`)
    }
    return handler(url, init)
  })

  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

/**
 * A success response, shaped as `backend/openapi.yaml` shapes them: the
 * resource itself, with no wrapper.
 */
export function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 204 with no body, as logout returns. */
export function noContent(): Response {
  return new Response(null, { status: 204 })
}

export function domainError(status: number, code: string, message = 'nope'): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Session recovery answers 401 until verify succeeds, then returns the session. */
export function authSessionRoutes(session: unknown, challenge: unknown) {
  let authed = false
  return {
    'GET /api/v1/auth/session': () =>
      authed ? ok(session) : domainError(401, 'AUTH_REQUIRED', 'Authentication required'),
    'POST /api/v1/auth/challenges': () => ok(challenge, 201),
    'POST /api/v1/auth/sessions': () => {
      authed = true
      return ok(session, 201)
    },
  }
}

/** A backend that cannot be reached at all. */
export function offline(): Handler {
  return () => {
    throw new TypeError('Failed to fetch')
  }
}

/* -- Builders ------------------------------------------------------------
 *
 * Shaped exactly like `backend/openapi.yaml`, so a test that passes here is
 * exercising the real wire contract rather than a convenient invention.
 * -------------------------------------------------------------------- */

export function aProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Alex Fitness',
    slug: 'alex-fitness',
    headline: 'Strength coaching in Kadıköy',
    bio: 'Ten years of one-to-one training.',
    avatarUrl: '',
    avatarVariant: 0,
    location: 'Istanbul',
    payoutWallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081',
    payoutVerifiedAt: '2026-02-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function aService(overrides: Partial<Service> = {}): Service {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    providerId: '00000000-0000-4000-8000-000000000002',
    name: 'Personal Training',
    description: 'One-to-one training.',
    category: 'fitness',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function aPass(overrides: Partial<Pass> = {}): Pass {
  return {
    id: '00000000-0000-4000-8000-000000000004',
    providerId: '00000000-0000-4000-8000-000000000002',
    serviceId: '00000000-0000-4000-8000-000000000003',
    title: '10 Personal Training Sessions',
    description: 'Ten one-to-one sessions.',
    sessions: 10,
    priceLuna: 25_000_000,
    currency: 'NIM',
    expirationAt: null,
    accent: null,
    coverMediaId: null,
    coverUrl: null,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function aPublicProvider(overrides: Partial<PublicProvider> = {}): PublicProvider {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Alex Fitness',
    slug: 'alex-fitness',
    headline: 'Strength coaching in Kadıköy',
    bio: 'Ten years of one-to-one training.',
    avatarUrl: '',
    avatarVariant: 0,
    location: 'Istanbul',
    wallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    ...overrides,
  }
}

/** The only shape public discovery returns. */
export function aPublicPass(overrides: Partial<PublicPass> = {}): PublicPass {
  const pass = overrides.pass ?? aPass()
  return {
    pass,
    provider: overrides.provider ?? aPublicProvider({ id: pass.providerId }),
    service: overrides.service ?? {
      id: pass.serviceId,
      name: 'Personal Training',
      description: 'One-to-one training.',
      category: 'fitness',
    },
  }
}
