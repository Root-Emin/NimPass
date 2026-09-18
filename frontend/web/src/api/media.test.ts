import { describe, expect, it } from 'vitest'

import { resolveCoverUrl } from './media'

describe('resolveCoverUrl', () => {
  it('keeps a contract media path fetchable', () => {
    const path = '/api/v1/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    expect(resolveCoverUrl(path)).toMatch(/\/api\/v1\/media\/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee$/)
  })

  it('refuses anything that is not a Nimpass media path', () => {
    expect(resolveCoverUrl('https://evil.example/x.jpg')).toBeNull()
    expect(resolveCoverUrl('javascript:alert(1)')).toBeNull()
    expect(resolveCoverUrl('/api/v1/media/../etc/passwd')).toBeNull()
    expect(resolveCoverUrl('/api/v1/passes/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBeNull()
    expect(resolveCoverUrl(null)).toBeNull()
  })
})
