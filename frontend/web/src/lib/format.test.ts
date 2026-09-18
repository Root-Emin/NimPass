import { describe, expect, it } from 'vitest'

import {
  LUNA_PER_NIM,
  formatNim,
  formatSessions,
  lunaToNimInput,
  nimToLuna,
  perSessionLuna,
  secondsUntil,
  shortenAddress,
} from './format'
import { createIdempotencyKey } from './utils'

describe('money formatting', () => {
  it('renders whole NIM without noise', () => {
    expect(formatNim(250 * LUNA_PER_NIM)).toBe('250 NIM')
  })

  it('keeps fractional Luna visible', () => {
    expect(formatNim(250_50_000)).toBe('250.5 NIM')
  })

  it('formats zero rather than failing', () => {
    expect(formatNim(0)).toBe('0 NIM')
  })
})

describe('address display', () => {
  it('never shows the full address (docs/03 §33)', () => {
    const address = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0081'
    const shortened = shortenAddress(address)
    expect(shortened).toBe('NQ07…81')
    expect(shortened.length).toBeLessThan(address.length)
  })
})

describe('sessions', () => {
  it('pluralises correctly', () => {
    expect(formatSessions(1)).toBe('1 session')
    expect(formatSessions(10)).toBe('10 sessions')
  })
})

describe('challenge countdown', () => {
  it('floors an elapsed deadline at zero', () => {
    const now = Date.parse('2026-09-13T10:00:00Z')
    expect(secondsUntil('2026-09-13T09:59:00Z', now)).toBe(0)
    expect(secondsUntil('2026-09-13T10:01:00Z', now)).toBe(60)
  })
})

describe('createIdempotencyKey', () => {
  it('still produces a unique key without a secure context', () => {
    const original = globalThis.crypto
    // LAN HTTP inside Nimiq Pay has no crypto.randomUUID (docs/04 §47).
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: original.getRandomValues.bind(original) },
    })

    try {
      const a = createIdempotencyKey()
      const b = createIdempotencyKey()
      expect(a).toHaveLength(32)
      expect(a).not.toBe(b)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original })
    }
  })
})

describe('NIM display exactness', () => {
  /**
   * Luna is the smallest unit, so NIM has exactly five decimals (docs/05 §8)
   * and the pass form accepts all of them. Rounding the display meant a
   * pass really priced at 0.00001 NIM rendered as "0 NIM" — a price that is
   * not the price (docs/03-DESIGN-SYSTEM.md §123).
   */
  it('shows every Luna the amount actually contains', () => {
    expect(formatNim(123_456)).toBe('1.23456 NIM')
    expect(formatNim(25_000_001)).toBe('250.00001 NIM')
    expect(formatNim(1)).toBe('0.00001 NIM')
  })

  it('does not invent decimals for whole NIM amounts', () => {
    expect(formatNim(25_000_000)).toBe('250 NIM')
    expect(formatNim(100_000)).toBe('1 NIM')
  })

  it('groups thousands without disturbing the fraction', () => {
    expect(formatNim(1_234_567_800_000)).toBe('12,345,678 NIM')
    expect(formatNim(1_234_567_800_001)).toBe('12,345,678.00001 NIM')
  })
})

describe('nimToLuna', () => {
  it('converts exactly, without going through a float', () => {
    expect(nimToLuna('250')).toBe(25_000_000)
    expect(nimToLuna('1.23456')).toBe(123_456)
    expect(nimToLuna('0.00001')).toBe(1)

    // The float path is what this exists to avoid: 1.23456 * 100000 is
    // 123455.99999999999 in binary floating point.
    expect(1.23456 * LUNA_PER_NIM).not.toBe(123_456)
  })

  it('refuses amounts that are not a whole number of Luna', () => {
    expect(nimToLuna('1.234567')).toBeNull()
    expect(nimToLuna('abc')).toBeNull()
    expect(nimToLuna('')).toBeNull()
    expect(nimToLuna('-5')).toBeNull()
  })

  it('round-trips through the editable form value', () => {
    for (const luna of [1, 123_456, 25_000_000, 25_050_000]) {
      expect(nimToLuna(lunaToNimInput(luna))).toBe(luna)
    }
  })
})

describe('perSessionLuna', () => {
  it('divides the pass price across its sessions', () => {
    expect(perSessionLuna(25_000_000, 10)).toBe(2_500_000)
  })

  it('returns null rather than dividing by zero', () => {
    expect(perSessionLuna(25_000_000, 0)).toBeNull()
  })
})
