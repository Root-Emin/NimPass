import { Calendar, CalendarOff, Check, CircleDashed } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { Skeleton } from '@/components/ui/skeleton'
import { civilToIso, DEFAULT_EXPIRY_TIME, isoToCivil } from '@/lib/civil-date'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PassSession, PassSessionStatus, ViewerRole } from '@/types/domain'

import type { SessionActions } from '@/hooks/use-pass-sessions'

/**
 * The pass, session by session.
 *
 * A pass used to be a number going down, and the only way to answer "which
 * session was that?" was to count backwards from a redemption list. Here every
 * session the pass was sold with is a row from the day it was bought: the ones
 * that happened, the one that is booked for Tuesday, and the ones nobody has
 * arranged yet.
 *
 * Both parties see this same list, because it is the same rows. When the
 * provider marks Tuesday delivered, the customer's next read says Completed
 * and the remaining count has moved — there is no second copy anywhere for the
 * two of them to disagree through (docs/01-PRODUCT.md §33).
 *
 * Design: a timeline, not a table (docs/03-DESIGN-SYSTEM.md §59). The ordinal
 * is decorative; every row says in words what it is and when
 * (§19 — never colour or a number alone).
 */

const STATUS_LABEL: Record<PassSessionStatus, string> = {
  UNSCHEDULED: 'Not scheduled',
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export function SessionTimeline({
  sessions,
  role,
  actions,
  isPending,
  passIsActive,
}: {
  sessions: PassSession[] | undefined
  role: ViewerRole
  actions: SessionActions
  isPending: boolean
  /** Sessions on an expired or completed pass are history, not a plan. */
  passIsActive: boolean
}) {
  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    )
  }

  const items = sessions ?? []
  if (items.length === 0) {
    return <p className="text-body text-ink-muted">This pass has no sessions recorded yet.</p>
  }

  return (
    <div className="space-y-4">
      {actions.error ? (
        <p
          role="alert"
          className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-small text-ink"
        >
          {actions.error}{' '}
          <button
            type="button"
            onClick={actions.dismissError}
            className="underline underline-offset-2"
          >
            Dismiss
          </button>
        </p>
      ) : null}

      <ol className="divide-y divide-line border-t border-line">
        {items.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            role={role}
            actions={actions}
            passIsActive={passIsActive}
          />
        ))}
      </ol>
    </div>
  )
}

function SessionRow({
  session,
  role,
  actions,
  passIsActive,
}: {
  session: PassSession
  role: ViewerRole
  actions: SessionActions
  passIsActive: boolean
}) {
  const [editing, setEditing] = useState(false)
  const open = session.status === 'UNSCHEDULED' || session.status === 'SCHEDULED'
  const busy = actions.pendingId === session.id
  const mayEdit = passIsActive && open

  return (
    <li className="py-4">
      <div className="flex items-baseline gap-4">
        <span
          aria-hidden="true"
          className={cn(
            'numeric w-7 shrink-0 font-display text-small font-semibold',
            session.status === 'COMPLETED' ? 'text-accent' : 'text-ink-subtle',
          )}
        >
          {String(session.sequenceNumber).padStart(2, '0')}
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-body text-ink">
            <StatusIcon status={session.status} />
            Session {session.sequenceNumber}
          </p>
          <p className="mt-0.5 text-small text-ink-subtle">{describe(session)}</p>
        </div>

        {mayEdit ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setEditing((was) => !was)}
            >
              {session.scheduledAt ? 'Reschedule' : 'Schedule'}
            </Button>
            {/*
              Provider only, and the backend refuses it for anyone else. The
              owner's way to spend a session is signing it in their wallet —
              the same proof of intent the product has always required
              (docs/DECISIONS.md ADR-007) — so offering them this button would
              be offering a control that cannot work.
            */}
            {role === 'PROVIDER' ? (
              <Button
                size="sm"
                loading={busy}
                disabled={busy}
                onClick={() => void actions.complete(session)}
              >
                Mark done
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {editing && mayEdit ? (
        <ScheduleEditor
          session={session}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (iso) => {
            await actions.schedule(session, iso)
            setEditing(false)
          }}
        />
      ) : null}
    </li>
  )
}

/** The one line under the session's name: what it is and when. */
function describe(session: PassSession): string {
  if (session.status === 'COMPLETED') {
    const by = session.completedBy === 'PROVIDER' ? 'Confirmed by your provider' : 'You used this'
    return session.completedAt ? `${by} · ${formatDateTime(session.completedAt)}` : by
  }
  if (session.status === 'CANCELLED') return 'Cancelled'
  if (session.scheduledAt) return formatDateTime(session.scheduledAt)
  return STATUS_LABEL.UNSCHEDULED
}

function StatusIcon({ status }: { status: PassSessionStatus }) {
  const className = 'size-4 shrink-0'
  if (status === 'COMPLETED') return <Check className={cn(className, 'text-accent')} aria-hidden="true" />
  if (status === 'SCHEDULED') return <Calendar className={cn(className, 'text-ink-muted')} aria-hidden="true" />
  if (status === 'CANCELLED') return <CalendarOff className={cn(className, 'text-ink-subtle')} aria-hidden="true" />
  return <CircleDashed className={cn(className, 'text-ink-subtle')} aria-hidden="true" />
}

/**
 * Picking a date for one session.
 *
 * The same date/time control the Pass form uses, for the same reason: a native
 * date input is a different thing on every OS and offers no time, and this has
 * to work identically in a desktop browser and inside the Nimiq Pay WebView.
 * The instant the customer picks is local; what travels is UTC.
 */
function ScheduleEditor({
  session,
  busy,
  onSave,
  onCancel,
}: {
  session: PassSession
  busy: boolean
  onSave: (iso: string | null) => Promise<void>
  onCancel: () => void
}) {
  const initial = session.scheduledAt ? isoToCivil(session.scheduledAt) : null
  const [date, setDate] = useState(initial?.date ?? '')
  const [time, setTime] = useState(initial?.time ?? DEFAULT_EXPIRY_TIME)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-4 ml-11 space-y-3 rounded-xl border border-line bg-surface-muted p-4">
      <DateTimePicker
        noun="session"
        date={date}
        time={time}
        error={error ?? undefined}
        onChange={(next) => {
          setDate(next.date)
          setTime(next.time)
          setError(null)
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={busy}
          disabled={busy}
          onClick={() => {
            const iso = civilToIso(date, time)
            if (!iso) {
              setError('Pick a date and a time.')
              return
            }
            void onSave(iso)
          }}
        >
          Save date
        </Button>
        {session.scheduledAt ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void onSave(null)}>
            Clear date
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
