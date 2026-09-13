import { vi } from 'vitest'

import type { Package, Provider, PublicOffer, Service } from '@/types/domain'

/**
 * Stubs `fetch` with a small route table so tests exercise the real API client,
 * envelope parsing and error mapping rather than mocking the API modules away.
 */
type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>

export function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: string; body: unknown }[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    calls.push({
      method,
      url: `${url.pathname}${url.search}`,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })

    const handler = routes[`${method} ${url.pathname}`] ?? routes[url.pathname]
    if (!handler) {
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
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function aPackage(overrides: Partial<Package> = {}): Package {
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
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** The only shape public discovery returns. */
export function anOffer(overrides: Partial<PublicOffer> = {}): PublicOffer {
  const pkg = overrides.package ?? aPackage()
  return {
    package: pkg,
    provider: overrides.provider ?? { id: pkg.providerId, name: 'Alex Fitness' },
    service: overrides.service ?? {
      id: pkg.serviceId,
      name: 'Personal Training',
      description: 'One-to-one training.',
    },
  }
}
