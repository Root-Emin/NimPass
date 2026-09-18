import { ApiError } from '@/api/errors'

import { FIXTURE_OFFERS } from './fixtures/catalogue'

/**
 * Answers read-only public catalogue requests from fixtures. See ./README.md.
 *
 * Scope is deliberately narrow, and matches `backend/openapi.yaml` exactly:
 * the three unauthenticated `/public/*` routes and nothing else. Purchases,
 * passes, redemptions and every provider call fall through to `unsupported()`,
 * which raises the same error the UI would see from a backend that cannot serve
 * the call — so those flows keep rendering their honest unavailable states
 * rather than a fabricated success.
 */

const LATENCY_MS = 220

export interface FixtureResponse {
  handled: boolean
  data?: unknown
}

export async function serveFromFixtures(
  path: string,
  method: string,
): Promise<FixtureResponse> {
  const route = new URL(path, 'http://fixtures.local').pathname

  if (method !== 'GET') return unsupported(route, method)

  await delay(LATENCY_MS)

  if (route === '/api/v1/public/passes') {
    // No query parameters in the contract: the whole published catalogue.
    return { handled: true, data: { items: FIXTURE_OFFERS } }
  }

  const passMatch = route.match(/^\/api\/v1\/public\/passes\/([^/]+)$/)
  if (passMatch) {
    const offer = FIXTURE_OFFERS.find((candidate) => candidate.pass.id === passMatch[1])
    if (!offer) throw notFound('NOT_FOUND', "This pass doesn't exist or was removed.")
    return { handled: true, data: offer }
  }

  const providerMatch = route.match(/^\/api\/v1\/public\/providers\/([^/]+)$/)
  if (providerMatch) {
    const offer = FIXTURE_OFFERS.find((candidate) => candidate.provider.id === providerMatch[1])
    if (!offer) throw notFound('NOT_FOUND', "This provider page doesn't exist.")
    return { handled: true, data: offer.provider }
  }

  return unsupported(route, method)
}

function notFound(code: string, message: string): ApiError {
  return new ApiError({ code, message, status: 404 })
}

/**
 * Anything outside the public catalogue. Reported as an unreachable backend,
 * because from the product's point of view that is exactly what it is.
 */
function unsupported(route: string, method: string): never {
  throw new ApiError({
    code: 'NETWORK_ERROR',
    message: `No backend for ${method} ${route}. Development fixtures only serve the public catalogue.`,
    status: 0,
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
