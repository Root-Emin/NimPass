import { fixturesEnabled } from '@/dev/fixture-mode'
import type { ApiErrorBody } from '@/types/api'

import { ApiError, toApiError } from './errors'

/**
 * The single place the frontend talks to the Nimpass backend.
 *
 * Components never call `fetch` directly (docs/08-ARCHITECTURE.md §77), and
 * every failure becomes an `ApiError` with a stable code so the UI branches on
 * codes rather than on string matching.
 *
 * Responses are returned as sent. `backend/openapi.yaml` — the canonical client
 * contract — declares every success body as the resource itself, with no
 * wrapper: `POST /auth/sessions` responds with `Session`, `GET /providers` with
 * `{ items }`, and so on.
 *
 * This contradicts docs/08-ARCHITECTURE.md §65, which sketches a `{ "data": … }`
 * success envelope. The implemented API and its OpenAPI spec agree with each
 * other and disagree with that section, so the contract wins here and the doc
 * needs an explicit update rather than a silent one. Errors *do* match §65:
 * `{ "error": { code, message, requestId } }`.
 */

const DEFAULT_BASE_URL = 'http://localhost:8080'

/**
 * Header carrying the double-submit CSRF token the backend issues at login
 * (`application.CSRFToken`). The session itself rides in an httpOnly cookie,
 * so it is unreadable here by design; this token is the readable half.
 */
const CSRF_HEADER = 'X-CSRF-Token'

let csrfToken: string | null = null

/** Stores the CSRF token for subsequent state-changing requests. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

export function getCsrfToken(): string | null {
  return csrfToken
}

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim()
  return (configured && configured.length > 0 ? configured : DEFAULT_BASE_URL).replace(/\/$/, '')
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /**
   * Sent as `Idempotency-Key`. Required for any request that can create money
   * movement or consume a session — docs/05-NIMIQ-PAY-INTEGRATION.md §68.
   */
  idempotencyKey?: string
  headers?: Record<string, string>
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, idempotencyKey, headers = {} } = options

  // Development-only: serve the public catalogue from presentation fixtures so
  // the marketplace surfaces can be designed before the backend exists. Guarded
  // by `import.meta.env.DEV`, so this branch and the fixture modules behind it
  // are removed from production builds. See src/dev/README.md.
  if (import.meta.env.DEV && fixturesEnabled()) {
    const { serveFromFixtures } = await import('@/dev/fixture-transport')
    const result = await serveFromFixtures(path, method)
    if (result.handled) return result.data as T
  }

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  }
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
  if (idempotencyKey) requestHeaders['Idempotency-Key'] = idempotencyKey
  if (csrfToken && method !== 'GET') requestHeaders[CSRF_HEADER] = csrfToken

  let response: Response
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // Wallet sessions are expected to travel as an httpOnly cookie rather
      // than a token in JS-reachable storage (docs/09-SECURITY.md §62).
      credentials: 'include',
    })
  } catch (error) {
    // No response at all: offline, DNS, CORS rejection, backend not running.
    throw toApiError(error)
  }

  if (response.status === 204) return undefined as T

  const payload = await readJson(response)

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null
    const domain = errorBody?.error
    throw new ApiError({
      code: domain?.code ?? 'HTTP_ERROR',
      message: domain?.message ?? `Request failed with status ${response.status}.`,
      status: response.status,
      details: domain?.details,
    })
  }

  if (payload === null || typeof payload !== 'object') {
    throw new ApiError({
      code: 'MALFORMED_RESPONSE',
      message: 'The server returned an unexpected response.',
      status: response.status,
    })
  }

  return payload as T
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
