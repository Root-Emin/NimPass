import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { messageForApiError } from '@/api'
import { WorkspaceHeader } from '@/components/layout/provider-shell'
import { WorkspaceGate } from '@/components/provider/workspace-gate'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { useMyService, useSaveService } from '@/hooks/use-provider-workspace'
import type { Service, ServiceStatus } from '@/types/domain'
import { FormFooter } from '@/components/ui/form-footer'

/**
 * Create and edit a service on one calm page (docs/03-DESIGN-SYSTEM.md §111).
 * No wizard: the field set does not justify one.
 */
export function ServiceFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams<{ id: string }>()

  return (
    <>
      <WorkspaceHeader
        title={mode === 'create' ? 'Create service' : 'Edit service'}
        description="A service is what you offer. Packages of sessions belong to it."
      />
      <div className="mt-8">
        <WorkspaceGate>
          <ServiceForm mode={mode} serviceId={mode === 'edit' ? id : undefined} />
        </WorkspaceGate>
      </div>
    </>
  )
}

interface ServiceDraft {
  name: string
  description: string
  /**
   * Required on update (`ServiceUpdate`), because an update is a full
   * replacement of the editable fields. A service must be ACTIVE before any of
   * its packages can be published, so this is the control that makes a provider
   * publishable — not a hidden side effect of saving.
   */
  status: ServiceStatus
}

function ServiceForm({ mode, serviceId }: { mode: 'create' | 'edit'; serviceId?: string }) {
  const existing = useMyService(serviceId)

  if (mode === 'edit') {
    if (existing.isPending) return <FormSkeleton rows={3} />
    if (existing.isError) {
      return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
    }
  }

  // Mounted only once any existing service has loaded, so the draft can be
  // seeded from the state initialiser rather than patched in by an effect.
  return <ServiceFields mode={mode} serviceId={serviceId} initial={existing.data} />
}

function ServiceFields({
  mode,
  serviceId,
  initial,
}: {
  mode: 'create' | 'edit'
  serviceId?: string
  initial?: Service
}) {
  const navigate = useNavigate()
  const save = useSaveService(serviceId)

  const [draft, setDraft] = useState<ServiceDraft>(() => ({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    status: initial?.status ?? 'DRAFT',
  }))
  const [errors, setErrors] = useState<Partial<Record<keyof ServiceDraft, string>>>({})

  // Leaving the page is the only success signal, and it only fires once the
  // backend confirmed the write.
  useEffect(() => {
    if (save.isSuccess) navigate('/provider/services')
  }, [save.isSuccess, navigate])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()

    const nextErrors: Partial<Record<keyof ServiceDraft, string>> = {}
    if (!draft.name.trim()) nextErrors.name = 'Give the service a name.'
    else if (draft.name.trim().length < 3) nextErrors.name = 'Use at least 3 characters.'

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    save.mutate({
      name: draft.name.trim(),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      status: draft.status,
    })
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className="space-y-6 p-5 sm:p-6">
        <Field label="Service name" error={errors.name} hint="For example, “Personal Training”.">
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              onChange={(event) => {
                setDraft((d) => ({ ...d, name: event.target.value }))
                setErrors((e) => ({ ...e, name: undefined }))
              }}
            />
          )}
        </Field>

        {mode === 'edit' ? (
          <Field
            label="Status"
            hint="Packages can only be published while their service is active."
          >
            {(props) => (
              <Select
                {...props}
                value={draft.status}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, status: event.target.value as ServiceStatus }))
                }
              >
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
                {/* Archiving is terminal in the contract, so it is offered but
                    never pre-selected. */}
                <option value="ARCHIVED">Archived</option>
              </Select>
            )}
          </Field>
        ) : null}

        <Field label="Description" optional hint="A sentence or two about how you work.">
          {(props) => (
            <Textarea
              {...props}
              value={draft.description}
              onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
              rows={5}
            />
          )}
        </Field>
      </Card>

      <FormFooter
        submitting={save.isPending}
        submitLabel={mode === 'create' ? 'Create service' : 'Save changes'}
        error={save.isError ? messageForApiError(save.error) : null}
        success={null}
        secondaryAction={
          <Button asChild type="button" variant="ghost">
            <Link to="/provider/services">Cancel</Link>
          </Button>
        }
      />
    </form>
  )
}

export function FormSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="space-y-6 p-6">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      ))}
    </Card>
  )
}
