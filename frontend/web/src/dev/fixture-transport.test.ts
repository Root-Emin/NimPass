import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/errors'

import { serveFromFixtures } from './fixture-transport'

/**
 * The fixture boundary is a safety property, not a convenience: fixtures may
 * dress the public catalogue and nothing else. See ./README.md.
 */
describe('fixture transport scope', () => {
  it('serves the three public routes the contract defines', async () => {
    const catalog = await serveFromFixtures('/api/v1/public/passes', 'GET')
    expect(catalog.handled).toBe(true)
    const items = (catalog.data as { items: { pass: { id: string } }[] }).items
    expect(items.length).toBeGreaterThan(0)

    const offer = await serveFromFixtures(
      `/api/v1/public/passes/${items[0]!.pass.id}`,
      'GET',
    )
    expect(offer.handled).toBe(true)
  })

  it.each([
    ['GET', '/api/v1/passes/40000000-0000-4000-8000-000000000001'],
    ['GET', '/api/v1/purchases'],
    ['GET', '/api/v1/purchases/aaaaaaaa-0000-4000-8000-000000000001'],
    ['GET', '/api/v1/providers/00000000-0000-4000-8000-000000000002/passes'],
  ])('refuses %s %s rather than inventing a result', async (method, route) => {
    await expect(serveFromFixtures(route, method)).rejects.toBeInstanceOf(ApiError)
  })

  it.each([
    ['POST', '/api/v1/purchases'],
    ['POST', '/api/v1/purchases/aaaaaaaa-0000-4000-8000-000000000001/reconcile'],
    ['POST', '/api/v1/passes/40000000-0000-4000-8000-000000000001/redemption-challenges'],
    ['POST', '/api/v1/redemptions/red_1/complete'],
    ['POST', '/api/v1/providers/00000000-0000-4000-8000-000000000002/services/svc/passes'],
    ['PATCH', '/api/v1/providers'],
  ])('never fakes a successful %s %s', async (method, route) => {
    await expect(serveFromFixtures(route, method)).rejects.toThrow(
      /Development fixtures only serve the public catalogue/,
    )
  })

  it('serves the whole published catalogue, because the contract has no filters', async () => {
    // `GET /public/passes` takes no query parameters. Fixtures must not
    // pretend otherwise, or Discover would be designed against a search the
    // backend never performs.
    const all = await serveFromFixtures('/api/v1/public/passes', 'GET')
    const filtered = await serveFromFixtures(
      '/api/v1/public/passes?search=guitar&category=Music',
      'GET',
    )
    expect(filtered.data).toEqual(all.data)
  })

  it('reports an unknown pass as a domain 404, not a network failure', async () => {
    let error: ApiError | null = null
    try {
      await serveFromFixtures('/api/v1/public/passes/00000000-0000-4000-8000-0000000000ff', 'GET')
    } catch (caught) {
      error = caught as ApiError
    }
    expect(error?.code).toBe('NOT_FOUND')
    expect(error?.status).toBe(404)
  })

  it('prices fixtures in integer Luna', async () => {
    const result = await serveFromFixtures('/api/v1/public/passes', 'GET')
    const items = (result.data as { items: { pass: { priceLuna: number } }[] }).items
    expect(items.every((item) => Number.isInteger(item.pass.priceLuna))).toBe(true)
  })
})
