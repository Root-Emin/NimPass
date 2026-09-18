import { describe, expect, it } from 'vitest'

import {
  civilToIso,
  compareCivil,
  formatYmd,
  isoToCivil,
  monthGrid,
  parseYmd,
  TIME_SLOTS,
  weekdayLabels,
} from '@/lib/civil-date'

describe('civil dates', () => {
  it('round-trips a local date and time through UTC', () => {
    const iso = civilToIso('2026-09-20', '21:00')
    expect(iso).not.toBeNull()
    expect(isoToCivil(iso!)).toEqual({ date: '2026-09-20', time: '21:00' })
  })

  it('rejects impossible calendar days', () => {
    expect(parseYmd('2026-02-31')).toBeNull()
    expect(civilToIso('2026-02-31', '12:00')).toBeNull()
  })

  it('builds a Monday-first September 2026 grid', () => {
    const cells = monthGrid(2026, 9, 1)
    expect(cells).toHaveLength(42)
    expect(formatYmd(cells[0]!)).toBe('2026-08-31')
    expect(cells[0]!.inMonth).toBe(false)
    expect(formatYmd(cells[1]!)).toBe('2026-09-01')
    expect(cells[1]!.inMonth).toBe(true)
    expect(compareCivil(cells[16]!, { y: 2026, m: 9, d: 16 })).toBe(0)
  })

  it('names weekdays from the week start', () => {
    const labels = weekdayLabels('en-US', 1)
    expect(labels).toHaveLength(7)
    expect(labels[0]).toMatch(/M/i)
    expect(TIME_SLOTS[0]).toBe('00:00')
    expect(TIME_SLOTS[42]).toBe('21:00')
    expect(TIME_SLOTS.at(-1)).toBe('23:30')
  })
})
