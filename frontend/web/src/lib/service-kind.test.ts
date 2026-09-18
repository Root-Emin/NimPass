import { describe, expect, it } from 'vitest'

import { resolveAccent, suggestAccent } from '@/lib/pass-accent'
import { serviceKind } from '@/lib/service-kind'

describe('serviceKind', () => {
  it('gives guitar lessons a music kind', () => {
    expect(serviceKind('Guitar Lessons').id).toBe('music')
    expect(serviceKind('Guitar Lessons').stepsMore).toBe('more music')
  })

  it('does not let a later tutoring term steal a music service', () => {
    expect(serviceKind('Piano lessons').id).toBe('music')
  })

  it('stays generic when nothing matches', () => {
    expect(serviceKind('Bookkeeping retainers').id).toBe('service')
  })
})

describe('pass accent', () => {
  it('lets a stored choice win over the service suggestion', () => {
    expect(resolveAccent('CLAY', 'Guitar Lessons', 'music')).toBe('CLAY')
  })

  it('suggests plum for music when nothing is stored', () => {
    expect(suggestAccent('Guitar Lessons', 'music')).toBe('PLUM')
  })

  it('ignores an illegal token instead of painting pine by default', () => {
    expect(resolveAccent('NEON', 'Guitar Lessons', 'music')).toBe('PLUM')
  })
})
