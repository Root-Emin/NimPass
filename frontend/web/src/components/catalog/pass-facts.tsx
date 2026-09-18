import {
  Calendar,
  Check,
  ChevronRight,
  ClipboardList,
  Coins,
  Gift,
  Layers,
  QrCode,
  Tag,
  Ticket,
  type LucideIcon,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

import { formatDate, formatNim, perSessionLuna } from '@/lib/format'
import { PASS_ACCENTS, resolveAccent, type PassAccent } from '@/lib/pass-accent'
import { serviceKind } from '@/lib/service-kind'
import { cn } from '@/lib/utils'
import type { Luna } from '@/types/domain'

/**
 * The facts a customer needs before they buy, and the three steps after.
 *
 * Structure follows the pass-page wireframe: a labelled panel of five facts,
 * then a numbered sequence. Colour is not the product accent — it is the
 * pass's own tone, chosen by the person who created it.
 */

export function PassFacts({
  sessions,
  priceLuna,
  serviceName,
  passTitle,
  expirationAt,
  accent,
}: {
  sessions: number
  priceLuna: Luna
  serviceName: string
  /** The pass's own name, so a service row that only repeats it can be left out. */
  passTitle?: string
  expirationAt: string | null
  accent: PassAccent | string | null
}) {
  const kind = serviceKind(serviceName)
  const tone = PASS_ACCENTS[resolveAccent(accent, serviceName, kind.id)]
  const perSession = perSessionLuna(priceLuna, sessions)
  const ServiceIcon = kind.icon

  return (
    <div className="space-y-8">
      <FactsPanel tone={tone} heading="Pass details" eyebrow="Everything you need to know" icon={ClipboardList}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-6">
          <Fact
            className="sm:col-span-2"
            icon={Layers}
            label="Total sessions"
            value={String(sessions)}
            color={tone.from}
            well={tone.well}
          />
          <Fact
            className="sm:col-span-2"
            icon={Coins}
            label="Total price"
            value={formatNim(priceLuna)}
            color={tone.from}
            well={tone.well}
          />
          <Fact
            className="sm:col-span-2"
            icon={Tag}
            label="Price per session"
            value={formatNim(perSession ?? 0)}
            color={tone.from}
            well={tone.well}
          />
          {/* A pass derives its service from its own name, so the two are
              often the same string — and printing it twice reads as a fault. */}
          {serviceName.trim().toLowerCase() === (passTitle ?? '').trim().toLowerCase() ? null : (
            <Fact
              className="sm:col-span-3"
              icon={ServiceIcon}
              label="Service"
              value={serviceName}
              color={tone.from}
              well={tone.well}
            />
          )}
          {/* A validity row only when the pass actually has a deadline. A pass
              without one says nothing about expiry rather than announcing the
              absence of it. */}
          {expirationAt ? (
            <Fact
              className="sm:col-span-3"
              icon={Calendar}
              label="Validity"
              value={`Until ${formatDate(expirationAt)}`}
              color={tone.from}
              well={tone.well}
            />
          ) : null}
        </dl>
      </FactsPanel>

      <FactsPanel
        tone={tone}
        heading="After you buy"
        eyebrow={`Simple steps, ${kind.stepsMore}`}
        icon={Gift}
      >
        <ol className="grid gap-4 sm:grid-cols-3">
          {AFTER_PURCHASE.map((step, index) => (
            <li key={step.title} className="relative rounded-2xl bg-white/70 px-5 py-5">
              {index < AFTER_PURCHASE.length - 1 ? (
                <ChevronRight
                  className="absolute -right-4 top-1/2 hidden size-5 -translate-y-1/2 text-ink-subtle sm:block"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className="flex size-9 items-center justify-center rounded-full font-display text-small font-semibold text-white"
                style={{ backgroundColor: tone.from }}
              >
                {index + 1}
              </span>
              <span
                className="mt-4 flex size-10 items-center justify-center rounded-full"
                style={{ backgroundColor: tone.well, color: tone.from }}
              >
                <step.icon className="size-5" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <p className="mt-4 text-body-lg font-medium text-ink">{step.title}</p>
              <p className="mt-1.5 text-small leading-relaxed text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </FactsPanel>
    </div>
  )
}

function FactsPanel({
  tone,
  heading,
  eyebrow,
  icon: Icon,
  children,
}: {
  tone: { from: string; wash: string; line: string }
  heading: string
  eyebrow: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <section
      className="rounded-2xl p-5 sm:p-7"
      style={
        {
          backgroundColor: tone.wash,
          border: `1px solid ${tone.line}`,
        } satisfies CSSProperties
      }
    >
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-h3 text-ink">
          <Icon className="size-5 shrink-0" strokeWidth={1.75} style={{ color: tone.from }} aria-hidden="true" />
          {heading}
        </h2>
        <p className="eyebrow text-ink-subtle">{eyebrow}</p>
      </header>
      {children}
    </section>
  )
}

function Fact({
  icon: Icon,
  label,
  value,
  color,
  well,
  className,
}: {
  icon: LucideIcon
  label: string
  value: string
  color: string
  well: string
  className?: string
}) {
  return (
    <div className={cn('flex gap-3.5', className)}>
      <span
        className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: well, color }}
      >
        <Icon className="size-5" strokeWidth={1.6} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-small text-ink-subtle">{label}</dt>
        <dd className="mt-0.5 truncate text-body-lg font-medium text-ink">{value}</dd>
      </div>
    </div>
  )
}

const AFTER_PURCHASE = [
  {
    icon: Ticket,
    title: 'Your pass appears in My Passes',
    body: 'All the sessions you bought, in one place, with nothing to print or remember.',
  },
  {
    icon: QrCode,
    title: 'Show your pass at each session',
    body: 'Your provider confirms it, and your remaining count goes down by exactly one.',
  },
  {
    icon: Check,
    title: 'Come back whenever suits you',
    body: 'Use the sessions at your own pace until the pass is finished.',
  },
] as const
