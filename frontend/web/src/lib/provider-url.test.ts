import { describe, expect, it } from 'vitest'

import { providerPath, providerUrl } from './provider-url'

/**
 * Provider links are built from stored data, never from a display name.
 *
 * The rule this file exists to hold: what goes in a URL is the slug the backend
 * assigned once and will never change, so a link somebody already sent keeps
 * resolving after a rename. A name is not an identifier — it repeats, it
 * changes, and it contains characters a path cannot carry.
 */
describe('providerPath', () => {
  it('addresses a provider by their stable slug', () => {
    expect(providerPath({ id: 'ba36b1e4-0c61-4a9f-9a2f-9f0b6d8a6f11', slug: 'emin' })).toBe(
      '/providers/emin',
    )
  })

  it('never builds a link out of the display name', () => {
    // A provider called "Fitness With Alex" whose slug is `fitness-with-alex-2`
    // — because someone took the readable one first — must link to the slug.
    const link = providerPath({ id: 'ba36b1e4-0c61-4a9f-9a2f-9f0b6d8a6f11', slug: 'fitness-with-alex-2' })
    expect(link).toBe('/providers/fitness-with-alex-2')
  })

  it('falls back to the id where a record carries no slug', () => {
    // A `Pass` carries `providerId` and no slug, and `/providers/:providerRef`
    // resolves both — a working link beats no link.
    expect(providerPath({ id: 'ba36b1e4-0c61-4a9f-9a2f-9f0b6d8a6f11' })).toBe(
      '/providers/ba36b1e4-0c61-4a9f-9a2f-9f0b6d8a6f11',
    )
    expect(providerPath({ id: 'ba36b1e4-0c61-4a9f-9a2f-9f0b6d8a6f11', slug: '' })).toBe(
      '/providers/ba36b1e4-0c61-4a9f-9a2f-9f0b6d8a6f11',
    )
    expect(providerPath({ id: 'ba36b1e4-0c61-4a9f-9a2f-9f0b6d8a6f11', slug: null })).toBe(
      '/providers/ba36b1e4-0c61-4a9f-9a2f-9f0b6d8a6f11',
    )
  })
})

describe('providerUrl', () => {
  it('builds the shareable link from the current origin, not a hardcoded domain', () => {
    // The same build runs on localhost, on a LAN address while a phone is
    // testing against Testnet, and in production. A copied link has to be the
    // one that works where the person copying it is.
    for (const origin of [
      'http://localhost:5173',
      'http://192.168.1.24:5173',
      'https://nimpass.app',
    ]) {
      expect(providerUrl({ id: 'x', slug: 'emin' }, origin)).toBe(`${origin}/providers/emin`)
    }
  })

  it('does not double the slash when the origin carries a trailing one', () => {
    expect(providerUrl({ id: 'x', slug: 'emin' }, 'https://nimpass.app/')).toBe(
      'https://nimpass.app/providers/emin',
    )
  })
})
