import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Shared submit row for provider forms.
 *
 * Success is only ever shown when the backend actually confirmed the write —
 * there is no optimistic "saved" here (docs/01-PRODUCT.md §49).
 */
export function FormFooter({
  submitting,
  submitLabel,
  error,
  success,
  secondaryAction,
}: {
  submitting: boolean
  submitLabel: string
  error: string | null
  success: string | null
  secondaryAction?: ReactNode
}) {
  return (
    <div className="mt-6 space-y-4">
      {error ? (
        <Alert tone="danger" icon={<AlertCircle />} title="Couldn't save">
          {error}
        </Alert>
      ) : null}

      {success ? <Alert tone="success" icon={<CheckCircle2 />} title={success} /> : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {secondaryAction}
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
