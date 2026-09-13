import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { messageForApiError } from '@/api'
import { WorkspaceHeader } from '@/components/layout/provider-shell'
import { WorkspaceGate } from '@/components/provider/workspace-gate'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { useMyPackages, usePublishPackage } from '@/hooks/use-provider-workspace'
import { formatDate, formatNim, formatSessions } from '@/lib/format'
import type { PackageStatus } from '@/types/domain'

/** `domain.PackageStatus`. */
const STATUS_TONE: Record<PackageStatus, { label: string; tone: BadgeProps['tone'] }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ACTIVE: { label: 'Published', tone: 'success' },
  UNAVAILABLE: { label: 'Not for sale', tone: 'warning' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
}

/**
 * Package management (docs/03-DESIGN-SYSTEM.md §69): simple status and concise
 * metadata, one row per package.
 */
export function ProviderPackagesPage() {
  return (
    <>
      <WorkspaceHeader
        title="Packages"
        description="Bundles of sessions people can buy. Publish one to put it in Discover."
        actions={
          <Button asChild>
            <Link to="/provider/packages/new">
              <Plus aria-hidden="true" />
              Create package
            </Link>
          </Button>
        }
      />
      <div className="mt-8">
        <WorkspaceGate>
          <PackageList />
        </WorkspaceGate>
      </div>
    </>
  )
}

function PackageList() {
  const packages = useMyPackages()
  const publish = usePublishPackage()

  if (packages.isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>
    )
  }

  if (packages.isError) {
    return <ErrorState error={packages.error} onRetry={() => void packages.refetch()} />
  }

  if (packages.data.items.length === 0) {
    return (
      <EmptyState
        title="No packages yet"
        description="Create your first package and start accepting NIM."
        action={
          <Button asChild>
            <Link to="/provider/packages/new">Create package</Link>
          </Button>
        }
      />
    )
  }

  return (
    <>
      {publish.isError ? (
        <p className="mb-4 text-body text-danger" role="alert">
          {messageForApiError(publish.error)}
        </p>
      ) : null}

      <ul className="space-y-3">
        {packages.data.items.map((item) => {
          const status = STATUS_TONE[item.status]
          const busy = publish.isPending && publish.variables === item.id

          return (
            <li key={item.id}>
              <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <p className="text-body-lg font-medium text-ink">{item.title}</p>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <p className="text-body text-ink-muted">
                    {formatSessions(item.sessions)} · {formatNim(item.priceLuna)}
                    {item.expirationAt ? ` · until ${formatDate(item.expirationAt)}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button asChild variant="secondary" size="sm">
                    <Link to={`/provider/packages/${item.id}/edit`}>Edit</Link>
                  </Button>

                  {/*
                    Publish is the only status transition in the contract.
                    `Package.status` includes UNAVAILABLE but no endpoint reaches
                    it, so there is no "stop selling" control to offer — an open
                    contract gap, not a hidden capability.
                  */}
                  {item.status === 'DRAFT' || item.status === 'UNAVAILABLE' ? (
                    <Button size="sm" loading={busy} onClick={() => publish.mutate(item.id)}>
                      Publish
                    </Button>
                  ) : null}
                </div>
              </Card>
            </li>
          )
        })}
      </ul>

    </>
  )
}
