/**
 * Civil (calendar) dates and clock times, in the viewer's local timezone.
 *
 * `Pass.expirationAt` is a UTC instant on the wire. The picker thinks in the
 * date and time a provider actually means, then this module is the one place
 * that conversion happens — so a 21:00 expiry is 21:00 on their clock, not
 * 21:00 UTC dressed as local (docs/08-ARCHITECTURE.md §35).
 */

export const DEFAULT_EXPIRY_TIME = '23:00'

/** Half-hour clock from 00:00 through 23:30. */
export const TIME_SLOTS: string[] = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
  const minute = index % 2 === 0 ? '00' : '30'
  return `${String(hour).padStart(2, '0')}:${minute}`
})

export interface CivilDate {
  y: number
  /** 1–12 */
  m: number
  d: number
}

export function parseYmd(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null
  }
  return { y, m, d }
}

export function formatYmd(date: CivilDate): string {
  return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
}

export function parseHm(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function civilToIso(date: string, time: string): string | null {
  const day = parseYmd(date)
  const clock = parseHm(time)
  if (!day || !clock) return null
  return new Date(day.y, day.m - 1, day.d, clock.hour, clock.minute, 0, 0).toISOString()
}

export function isoToCivil(iso: string): { date: string; time: string } | null {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return null
  return {
    date: formatYmd({
      y: instant.getFullYear(),
      m: instant.getMonth() + 1,
      d: instant.getDate(),
    }),
    time: `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`,
  }
}

export function todayCivil(now: Date = new Date()): CivilDate {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }
}

export function compareCivil(a: CivilDate, b: CivilDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d
}

export function addMonths(date: CivilDate, delta: number): CivilDate {
  const shifted = new Date(date.y, date.m - 1 + delta, 1)
  return { y: shifted.getFullYear(), m: shifted.getMonth() + 1, d: 1 }
}

/**
 * 1 = Monday … 7 = Sunday, as `Intl.Locale.prototype.getWeekInfo` reports.
 * Falls back to Monday, which is the ISO week and the Turkish calendar.
 */
export function weekStartsOn(locale: string): number {
  try {
    const object = new Intl.Locale(locale) as Intl.Locale & {
      weekInfo?: { firstDay: number }
      getWeekInfo?: () => { firstDay: number }
    }
    const first = object.weekInfo?.firstDay ?? object.getWeekInfo?.().firstDay
    if (first === 7) return 0
    if (typeof first === 'number') return first % 7
  } catch {
    // Locale without weekInfo — treat as ISO.
  }
  return 1
}

export interface CalendarCell extends CivilDate {
  inMonth: boolean
}

/** Six weeks of cells covering `month` (1–12), padded with adjacent days. */
export function monthGrid(year: number, month: number, weekStart: number): CalendarCell[] {
  const first = new Date(year, month - 1, 1)
  const offset = (first.getDay() - weekStart + 7) % 7
  const start = new Date(year, month - 1, 1 - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    return {
      y: day.getFullYear(),
      m: day.getMonth() + 1,
      d: day.getDate(),
      inMonth: day.getMonth() === month - 1,
    }
  })
}

export function weekdayLabels(locale: string, weekStart: number): string[] {
  const monday = new Date(Date.UTC(2021, 2, 1))
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday)
    day.setUTCDate(monday.getUTCDate() + ((index + weekStart + 6) % 7))
    return new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' })
      .format(day)
      .replace(/\.$/, '')
  })
}

export function formatChipDate(ymd: string, locale: string): string {
  const parsed = parseYmd(ymd)
  if (!parsed) return ''
  const date = new Date(parsed.y, parsed.m - 1, parsed.d)
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date)
  const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date).replace(/\.$/, '')
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date).replace(/\.$/, '')
  return `${day} ${month} ${weekday}`
}

export function formatMonthTitle(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(year, month - 1, 1))
}

export function slotsFor(time: string): string[] {
  if (!time || TIME_SLOTS.includes(time)) return TIME_SLOTS
  return [...TIME_SLOTS, time].sort()
}
