import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { messageForApiError } from '@/api'
import { WorkspaceHeader } from '@/components/layout/provider-shell'
import { WorkspaceGate } from '@/components/provider/workspace-gate'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input, InputAffix, Select, Textarea } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/states'
import {
  useMyPackage,
  useMyServices,
  useSavePackage,
} from '@/hooks/use-provider-workspace'
import { formatNim, lunaToNimInput, nimToLuna, perSessionLuna } from '@/lib/format'
import type { Package, Service } from '@/types/domain'
import { FormFooter } from '@/components/ui/form-footer'
import { validatePackageDraft } from '@/pages/provider/package-validation'
import { FormSkeleton } from '@/pages/provider/service-form'
import { Info } from 'lucide-react'

/**
 * Create and edit a package — one calm page, as in docs/03-DESIGN-SYSTEM.md
 * §70 and §111.
 *
 * The price is typed in NIM because that is what a provider thinks in, and
 * converted to integer Luna before it leaves the browser
 * (docs/05-NIMIQ-PAY-INTEGRATION.md §6-9). It is still only *input*: the
 * backend decides what a package actually costs (docs/08-ARCHITECTURE.md §71).
 */
export function PackageFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams<{ id: string }>()

  return (
    <>
      <WorkspaceHeader
        title={mode === 'create' ? 'Create package' : 'Edit package'}
        description="A bundle of sessions for one of your services."
      />
      <div className="mt-8">
        <WorkspaceGate>
          <PackageForm mode={mode} packageId={mode === 'edit' ? id : undefined} />
        </WorkspaceGate>
      </div>
    </>
  )
}

export interface PackageDraft {
  serviceId: string
  title: string
  sessionCount: string
  priceNim: string
  expiresOn: string
  description: string
}

const EMPTY: PackageDraft = {
  serviceId: '',
  title: '',
  sessionCount: '',
  priceNim: '',
  expiresOn: '',
  description: '',
}

function PackageForm({ mode, packageId }: { mode: 'create' | 'edit'; packageId?: string }) {
  const services = useMyServices()
  const existing = useMyPackage(packageId)

  if (mode === 'edit') {
    if (existing.isPending) return <FormSkeleton rows={5} />
    if (existing.isError) {
      return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
    }
  }

  if (services.isPending) return <FormSkeleton rows={5} />
  if (services.isError) {
    return <ErrorState error={services.error} onRetry={() => void services.refetch()} />
  }

  // A package must belong to a service, so there is nothing to fill in yet.
  if (services.data.items.length === 0) {
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <h2 className="text-h3 text-ink">Add a service first</h2>
        <p className="max-w-lg text-body text-ink-muted">
          Packages belong to a service. Create the service you offer, then come back and price a
          bundle of sessions for it.
        </p>
        <Button asChild>
          <Link to="/provider/services/new">Create service</Link>
        </Button>
      </Card>
    )
  }

  // Everything the form needs has loaded, so the draft is seeded from the state
  // initialiser rather than reconciled by an effect.
  return (
    <PackageFields
      mode={mode}
      packageId={packageId}
      services={services.data.items}
      initial={existing.data}
    />
  )
}

function PackageFields({
  mode,
  packageId,
  services,
  initial,
}: {
  mode: 'create' | 'edit'
  packageId?: string
  services: Service[]
  initial?: Package
}) {
  const navigate = useNavigate()
  const save = useSavePackage(packageId)

  const [draft, setDraft] = useState<PackageDraft>(() =>
    initial
      ? {
          serviceId: initial.serviceId,
          title: initial.title,
          sessionCount: String(initial.sessions),
          priceNim: lunaToNimInput(initial.priceLuna),
          expiresOn: initial.expirationAt ? initial.expirationAt.slice(0, 10) : '',
          description: initial.description ?? '',
        }
      : EMPTY,
  )
  const [errors, setErrors] = useState<Partial<Record<keyof PackageDraft, string>>>({})

  useEffect(() => {
    if (save.isSuccess) navigate('/provider/packages')
  }, [save.isSuccess, navigate])

  const set = <K extends keyof PackageDraft>(key: K, value: PackageDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({ ...previous, [key]: undefined }))
  }

  // Parsed with Number, not parseInt: parseInt('7.4') silently becomes 7, which
  // would let a fractional session count through validation
  // (docs/08-ARCHITECTURE.md §76).
  const sessionCount = draft.sessionCount.trim() === '' ? Number.NaN : Number(draft.sessionCount)
  // The single NIM → Luna conversion (docs/05 §9). It parses the decimal string
  // rather than multiplying a float, and returns null for anything that is not
  // a whole number of Luna.
  const priceLuna = nimToLuna(draft.priceNim)
  const perSession =
    priceLuna !== null && priceLuna > 0 ? perSessionLuna(priceLuna, sessionCount) : null

  const submit = (event: React.FormEvent) => {
    event.preventDefault()

    const next = validatePackageDraft(draft, { sessionCount, priceLuna })

    setErrors(next)
    if (Object.keys(next).length > 0) return

    save.mutate({
      serviceId: draft.serviceId,
      title: draft.title.trim(),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      sessions: sessionCount,
      priceLuna: priceLuna as number,
      // `PackageInput.expirationAt` is an absolute UTC instant. End-of-day keeps
      // the chosen date usable for its whole span. The contract has no relative
      // duration, so none is invented (docs/01-PRODUCT.md §18).
      expirationAt: draft.expiresOn.trim()
        ? new Date(`${draft.expiresOn}T23:59:59Z`).toISOString()
        : null,
    })
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className="space-y-6 p-5 sm:p-6">
        <Field label="Service" error={errors.serviceId}>
          {(props) => (
            <Select
              {...props}
              value={draft.serviceId}
              onChange={(event) => set('serviceId', event.target.value)}
            >
              <option value="">Choose a service…</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Package name"
          error={errors.title}
          hint="For example, “10 Personal Training Sessions”."
        >
          {(props) => (
            <Input
              {...props}
              value={draft.title}
              onChange={(event) => set('title', event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Number of sessions" error={errors.sessionCount}>
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={draft.sessionCount}
                onChange={(event) => set('sessionCount', event.target.value)}
              />
            )}
          </Field>

          <Field label="Price" error={errors.priceNim}>
            {(props) => (
              <InputAffix
                {...props}
                affix="NIM"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.00001"
                value={draft.priceNim}
                onChange={(event) => set('priceNim', event.target.value)}
              />
            )}
          </Field>
        </div>

        {perSession !== null ? (
          <p className="-mt-2 text-small text-ink-subtle">
            That works out at {formatNim(perSession)} per session.
          </p>
        ) : null}

        <Field
          label="Valid until"
          optional
          error={errors.expiresOn}
          hint="The date the pass stops being usable. Leave empty for no expiry."
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              value={draft.expiresOn}
              onChange={(event) => set('expiresOn', event.target.value)}
            />
          )}
        </Field>

        <Field label="Description" optional hint="What someone gets, and how the sessions run.">
          {(props) => (
            <Textarea
              {...props}
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
              rows={5}
            />
          )}
        </Field>
      </Card>

      <Alert className="mt-4" tone="neutral" icon={<Info />}>
        {mode === 'create'
          ? 'New packages are saved as a draft. You publish them from the Packages screen when you are ready.'
          : 'Editing a package changes what new customers buy. Passes people already bought keep the terms they paid for.'}
      </Alert>

      <FormFooter
        submitting={save.isPending}
        submitLabel={mode === 'create' ? 'Create package' : 'Save changes'}
        error={save.isError ? messageForApiError(save.error) : null}
        success={null}
        secondaryAction={
          <Button asChild type="button" variant="ghost">
            <Link to="/provider/packages">Cancel</Link>
          </Button>
        }
      />
    </form>
  )
}
