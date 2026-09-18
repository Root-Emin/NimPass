import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiRequest } from './client'
import { ApiError, messageForApiError, toApiError } from './errors'

/** Awaits a rejection and returns it typed, so assertions stay readable. */
async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    return error as ApiError
  }
  throw new Error('Expected the request to reject')
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('returns the response body as sent, with no envelope', async () => {
    // `backend/openapi.yaml` declares every success body as the resource
    // itself. docs/08-ARCHITECTURE.md §65 sketches a `{ data }` wrapper the
    // implemented API does not use; the contract wins.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: 'pkg_1', title: 'Ten sessions' })))

    await expect(apiRequest<{ id: string }>('/api/v1/public/passes/pkg_1')).resolves.toEqual({
      id: 'pkg_1',
      title: 'Ten sessions',
    })
  })

  it('turns a domain error envelope into an ApiError carrying the stable code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'PASS_COMPLETED', message: 'no sessions' } }, 409),
      ),
    )

    const error = await captureError(apiRequest('/api/v1/redemptions/r1/complete'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('PASS_COMPLETED')
    expect(error.status).toBe(409)
    expect(error.isDomainError).toBe(true)
    expect(error.isNetworkError).toBe(false)
  })

  it('distinguishes an unreachable backend from a domain rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const error = await captureError(apiRequest('/api/v1/public/passes'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.isNetworkError).toBe(true)
    expect(error.isDomainError).toBe(false)
    expect(error.status).toBe(0)
  })

  it('rejects a response that is not JSON at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>gateway error</html>', { status: 200 })),
    )

    const error = await captureError(apiRequest('/api/v1/public/passes'))
    expect(error.code).toBe('MALFORMED_RESPONSE')
  })

  it('sends the idempotency key for money-moving requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { id: 'purchase_1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/api/v1/purchases', {
      method: 'POST',
      body: { passId: 'pkg_1' },
      idempotencyKey: 'key-123',
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-123')
    expect(init.method).toBe('POST')
  })

  it('does not set JSON content-type on a multipart upload', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'media_1' }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const body = new FormData()
    body.append('file', new File(['jpeg'], 'cover.jpg', { type: 'image/jpeg' }))
    await apiRequest('/api/v1/media', { method: 'POST', body })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('keeps an aborted request out of the error reporting path', () => {
    const aborted = new DOMException('aborted', 'AbortError')
    const error = toApiError(aborted)
    expect(error.isAborted).toBe(true)
    expect(error.isNetworkError).toBe(false)
  })
})

describe('messageForApiError', () => {
  it('translates stable domain codes into human copy', () => {
    const error = new ApiError({ code: 'PASS_COMPLETED', message: 'raw', status: 409 })
    expect(messageForApiError(error)).toBe('This pass has no sessions remaining.')
  })

  it('never surfaces raw internals for unknown failures', () => {
    expect(messageForApiError(new Error('pq: duplicate key value'))).not.toContain('pq:')
  })
})
