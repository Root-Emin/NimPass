import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AlertCircle, Calendar, Coins, Divide, Layers } from 'lucide-react'
import type { ReactNode } from 'react'

import { PassPreview } from '@/components/catalog/pass-preview'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DialogOverlay, DialogPositioner } from '@/components/ui/dialog'
import { dialogPanelClass } from '@/components/ui/dialog-panel'
import { formatDate, formatNim, formatSessions, perSessionLuna } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PassAccent } from '@/lib/pass-accent'
import type { Luna } from '@/types/domain'

/**
 * The last look before a Pass exists.
 *
 * Creating a Pass used to happen the instant the button was pressed, which
 * meant the first time anyone saw the whole thing assembled was after it had
 * been made. This is the pause: the artwork as customers will meet it, the
 * terms written out in words, and two ways out — make it, or go back and keep
 * editing.
 *
 * Nothing here is a second source of truth. Every value is the form's own
 * state, rendered through the same preview component the form shows while it is
 * being filled in, so the dialog cannot drift from what is about to be sent.
 * Confirming is also the only thing that writes: opening this dialog costs no
 * request, and closing it costs nothing at all — the form is still mounted
 * behind it with every field, the uploaded cover included, exactly as it was.
 *
 * What confirming writes is a Pass that is *on sale*. There is no draft step
 * behind a second button any more, so the copy here says so: this is the last
 * look before customers can see it.
 */
export interface PassConfirmation {
  title: string
  serviceName: string | null
  providerName: string | null
  sessions: number | null
  priceLuna: Luna | null
  accent: PassAccent
  coverSrc: string | null
  description: string
  /** ISO date the pass stops being usable, or null when it has no deadline. */
  expiresAt: string | null
}

export function PassConfirmDialog({
  open,
  onOpenChange,
  pass,
  busy,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pass: PassConfirmation
  /** True while the Pass is being created and published. Both actions lock. */
  busy: boolean
  /** Whatever the backend said, when a confirmed attempt failed. */
  error?: ReactNode
  onConfirm: () => void
}) {
  const perSession =
    pass.priceLuna !== null && pass.sessions !== null
      ? perSessionLuna(pass.priceLuna, pass.sessions)
      : null

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // A create in flight is not interruptible: the request is already on
        // its way and closing here would hide the only thing reporting it.
        if (busy) return
        onOpenChange(next)
      }}
    >
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPositioner>
          <DialogPrimitive.Content
            role="alertdialog"
            className={cn(dialogPanelClass, 'max-w-lg gap-6 sm:p-7')}
          >
            <div className="space-y-1.5">
              <DialogPrimitive.Title className="text-h3 font-semibold text-ink">
                Ready to create this Pass?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-body text-ink-muted">
                This is how your Pass will look and what it will cost. Creating it puts it in
                Discover straight away, where anyone can buy it — you can keep editing if
                something is not right yet.
              </DialogPrimitive.Description>
            </div>

            <div className="grid gap-5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:items-start">
              <PassPreview
                title={pass.title}
                serviceName={pass.serviceName}
                providerName={pass.providerName}
                sessions={pass.sessions}
                priceLuna={pass.priceLuna}
                accent={pass.accent}
                coverSrc={pass.coverSrc}
                compact
              />

              <div className="min-w-0 space-y-4">
                <div>
                  <p className="font-display text-body-lg font-semibold text-ink">
                    {pass.title.trim() || 'Pass name'}
                  </p>
                  {pass.providerName ? (
                    <p className="truncate text-small text-ink-muted">{pass.providerName}</p>
                  ) : null}
                </div>

                <dl className="divide-y divide-line rounded-xl border border-line bg-surface-muted/50">
                  <Row
                    icon={<Layers />}
                    label="Sessions"
                    value={pass.sessions === null ? '—' : formatSessions(pass.sessions)}
                  />
                  <Row
                    icon={<Coins />}
                    label="Price"
                    value={pass.priceLuna === null ? '—' : formatNim(pass.priceLuna)}
                  />
                  <Row
                    icon={<Divide />}
                    label="Per session"
                    value={perSession === null ? '—' : formatNim(perSession)}
                  />
                  {pass.expiresAt ? (
                    <Row
                      icon={<Calendar />}
                      label="Ends"
                      value={formatDate(pass.expiresAt)}
                    />
                  ) : null}
                </dl>

                {pass.description.trim() ? (
                  <div className="space-y-1">
                    <p className="eyebrow text-ink-subtle">Description</p>
                    <p className="line-clamp-5 whitespace-pre-line text-small leading-relaxed text-ink-muted">
                      {pass.description.trim()}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            {error ? (
              <Alert tone="danger" icon={<AlertCircle />} title="Couldn't create this Pass">
                {error}
              </Alert>
            ) : null}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Continue editing
              </Button>
              {/*
                One action, and it is disabled for as long as the create is in
                flight — a second press cannot produce a second Pass.
              */}
              <Button type="button" loading={busy} disabled={busy} onClick={onConfirm}>
                Create Pass
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPositioner>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
      <dt className="flex min-w-0 items-center gap-2.5 text-small text-ink-muted">
        <span className="text-ink-subtle [&>svg]:size-4 [&>svg]:shrink-0" aria-hidden="true">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </dt>
      <dd className="numeric shrink-0 text-small font-medium text-ink">{value}</dd>
    </div>
  )
}
