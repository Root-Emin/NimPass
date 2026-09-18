import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type RefObject,
} from 'react'

import {
  addMonths,
  compareCivil,
  DEFAULT_EXPIRY_TIME,
  formatChipDate,
  formatMonthTitle,
  formatYmd,
  monthGrid,
  parseYmd,
  slotsFor,
  todayCivil,
  weekStartsOn,
  weekdayLabels,
  type CivilDate,
} from '@/lib/civil-date'
import { cn } from '@/lib/utils'

type Panel = 'date' | 'time'

/**
 * Date and time, as two coordinated panels — a month grid and a half-hour
 * list — sharing one segmented header.
 *
 * The native date input is a different control on every OS, and it cannot
 * offer a time. This is the same object on desktop, a phone, and inside the
 * Mini App WebView: tap the date, tap the time, the instant is local and the
 * wire form is UTC.
 */
export function DateTimePicker({
  date,
  time,
  onChange,
  error,
  locale = typeof navigator === 'undefined' ? 'en' : navigator.language || 'en',
  now,
  noun = 'end',
}: {
  date: string
  time: string
  onChange: (next: { date: string; time: string }) => void
  error?: string
  locale?: string
  now?: Date
  /**
   * What this instant *is*, in the accessible names.
   *
   * The control was written for a Pass's expiry, so every label said "end
   * date". It now also picks when a session will happen, where "Choose end
   * date" is simply the wrong sentence. One word, supplied by the caller, and
   * the default keeps every existing use reading exactly as it did.
   */
  noun?: string
}) {
  const clock = now ?? new Date()
  const today = todayCivil(clock)
  const selected = parseYmd(date)
  const clockTime = time || DEFAULT_EXPIRY_TIME

  const [panel, setPanel] = useState<Panel | null>(null)
  const [cursor, setCursor] = useState<CivilDate>(() => selected ?? today)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedTimeRef = useRef<HTMLButtonElement>(null)
  const labelId = useId()

  const weekStart = weekStartsOn(locale)
  const labels = useMemo(() => weekdayLabels(locale, weekStart), [locale, weekStart])
  const cells = useMemo(
    () => monthGrid(cursor.y, cursor.m, weekStart),
    [cursor.y, cursor.m, weekStart],
  )
  const slots = useMemo(() => slotsFor(clockTime), [clockTime])

  useEffect(() => {
    if (selected) setCursor(selected)
  }, [date])

  useEffect(() => {
    if (!panel) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPanel(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [panel])

  useLayoutEffect(() => {
    if (panel !== 'time') return
    selectedTimeRef.current?.scrollIntoView?.({ block: 'center' })
  }, [panel, clockTime])

  const open = (next: Panel | null) => {
    if (next === 'time' && !selected) {
      setPanel('date')
      return
    }
    setPanel(next)
  }

  const pickDay = (cell: CivilDate) => {
    if (compareCivil(cell, today) < 0) return
    const nextTime = time || DEFAULT_EXPIRY_TIME
    onChange({ date: formatYmd(cell), time: nextTime })
    setCursor(cell)
    setPanel('time')
  }

  const pickTime = (slot: string) => {
    if (!selected) return
    onChange({ date, time: slot })
  }

  const clear = () => {
    onChange({ date: '', time: '' })
    setPanel(null)
  }

  const dateLabel = selected ? formatChipDate(date, locale) : 'Date'
  const timeLabel = selected ? clockTime : 'Time'

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex items-center justify-end gap-1.5"
      >
        <span id={labelId} className="sr-only">
          {capitalise(noun)} date and time
        </span>
        <Segment
          pressed={panel === 'date'}
          onClick={() => open(panel === 'date' ? null : 'date')}
          aria-haspopup="dialog"
          aria-expanded={panel === 'date'}
          aria-label={selected ? `${capitalise(noun)} date, ${dateLabel}` : `Choose ${noun} date`}
        >
          {dateLabel}
        </Segment>
        <Segment
          pressed={panel === 'time'}
          onClick={() => open(panel === 'time' ? null : 'time')}
          disabled={!selected}
          aria-haspopup="listbox"
          aria-expanded={panel === 'time'}
          aria-label={selected ? `${capitalise(noun)} time, ${timeLabel}` : `Choose ${noun} time`}
        >
          {timeLabel}
        </Segment>
        {selected ? (
          <button
            type="button"
            onClick={clear}
            aria-label={`Remove ${noun} date`}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink sm:size-9"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {panel ? (
        <div
          role="dialog"
          aria-label={panel === 'date' ? 'Choose a date' : 'Choose a time'}
          className="absolute right-0 z-20 mt-2 w-[min(100vw-2.5rem,20.5rem)] rounded-2xl border border-line bg-surface p-3 shadow-raised animate-dialog-in"
        >
          {panel === 'date' ? (
            <CalendarMonth
              locale={locale}
              labels={labels}
              cells={cells}
              today={today}
              selected={selected}
              title={formatMonthTitle(cursor.y, cursor.m, locale)}
              onPrev={() => setCursor((current) => addMonths(current, -1))}
              onNext={() => setCursor((current) => addMonths(current, 1))}
              onPick={pickDay}
            />
          ) : (
            <TimeList
              slots={slots}
              value={clockTime}
              selectedRef={selectedTimeRef}
              disableBefore={
                selected && compareCivil(selected, today) === 0
                  ? `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`
                  : null
              }
              onPick={pickTime}
            />
          )}
        </div>
      ) : null}

      {error ? (
        <p className="mt-1.5 text-right text-small text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function Segment({
  pressed,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-11 min-w-[5.5rem] items-center justify-center rounded-full px-3.5 text-small font-medium transition-colors duration-[--nimpass-duration-fast] sm:h-9',
        pressed
          ? 'bg-ink text-ink-inverse'
          : 'bg-surface-muted text-ink hover:bg-surface-inset',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function CalendarMonth({
  locale,
  labels,
  cells,
  today,
  selected,
  title,
  onPrev,
  onNext,
  onPick,
}: {
  locale: string
  labels: string[]
  cells: Array<CivilDate & { inMonth: boolean }>
  today: CivilDate
  selected: CivilDate | null
  title: string
  onPrev: () => void
  onNext: () => void
  onPick: (cell: CivilDate) => void
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <p className="font-display text-h3 font-semibold capitalize tracking-tight text-ink">
          {title}
        </p>
        <div className="flex items-center">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous month"
            className="flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink sm:size-9"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next month"
            className="flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink sm:size-9"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7" role="grid" aria-label={title}>
        {labels.map((label, index) => (
          <span
            key={`${label}-${index}`}
            className="flex h-8 items-center justify-center text-micro font-medium text-ink-subtle"
          >
            {label}
          </span>
        ))}
        {cells.map((cell) => {
          const key = formatYmd(cell)
          const isSelected = selected ? compareCivil(cell, selected) === 0 : false
          const isToday = compareCivil(cell, today) === 0
          const disabled = compareCivil(cell, today) < 0
          return (
            <button
              key={key + String(cell.inMonth)}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              disabled={disabled}
              onClick={() => onPick(cell)}
              className={cn(
                'mx-auto flex size-10 items-center justify-center rounded-full text-small font-medium transition-colors duration-[--nimpass-duration-fast]',
                isSelected && 'bg-ink text-ink-inverse',
                !isSelected && isToday && 'ring-1 ring-inset ring-ink/25',
                !isSelected && cell.inMonth && !disabled && 'text-ink hover:bg-surface-muted',
                !isSelected && !cell.inMonth && !disabled && 'text-ink-subtle hover:bg-surface-muted',
                disabled && 'text-ink-subtle/40',
              )}
            >
              <span aria-hidden="true">{cell.d}</span>
              <span className="sr-only">
                {new Intl.DateTimeFormat(locale, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                }).format(new Date(cell.y, cell.m - 1, cell.d))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TimeList({
  slots,
  value,
  selectedRef,
  disableBefore,
  onPick,
}: {
  slots: string[]
  value: string
  selectedRef: RefObject<HTMLButtonElement | null>
  disableBefore: string | null
  onPick: (slot: string) => void
}) {
  return (
    <div
      role="listbox"
      aria-label="Time"
      className="-mx-1 max-h-72 overflow-y-auto overscroll-contain px-1 py-1"
    >
      {slots.map((slot) => {
        const selected = slot === value
        const disabled = disableBefore !== null && slot <= disableBefore
        return (
          <button
            key={slot}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={disabled}
            ref={selected ? selectedRef : undefined}
            onClick={() => onPick(slot)}
            className={cn(
              'flex h-11 w-full items-center justify-center rounded-full text-body font-medium transition-colors duration-[--nimpass-duration-fast]',
              selected
                ? 'bg-ink text-ink-inverse'
                : 'text-ink hover:bg-surface-muted',
              disabled && 'text-ink-subtle/40 hover:bg-transparent',
            )}
          >
            {slot}
          </button>
        )
      })}
    </div>
  )
}

/** Sentence case for an accessible name that starts a phrase. */
function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
