import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { WorkspaceHeader } from '@/components/layout/provider-shell'
import { WorkspaceGate } from '@/components/provider/workspace-gate'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { useMyPackages, useMyServices } from '@/hooks/use-provider-workspace'

/**
 * Services are containers for packages, and the screen keeps that simple
 * (docs/03-DESIGN-SYSTEM.md §68). A stacked list rather than a table, because
 * the content is not really tabular (§66).
 */
export function ProviderServicesPage() {
  return (
    <>
      <WorkspaceHeader
        title="Services"
        description="What you offer. Each service holds the packages people can buy."
        actions={
          <Button asChild>
            <Link to="/provider/services/new">
              <Plus aria-hidden="true" />
              Create service
            </Link>
          </Button>
        }
      />
      <div className="mt-8">
        <WorkspaceGate>
          <ServiceList />
        </WorkspaceGate>
      </div>
    </>
  )
}

function ServiceList() {
  const services = useMyServices()
  const packages = useMyPackages()

  if (services.isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-lg" />
        ))}
      </div>
    )
  }

  if (services.isError) {
    return <ErrorState error={services.error} onRetry={() => void services.refetch()} />
  }

  if (services.data.items.length === 0) {
    return (
      <EmptyState
        title="No services yet"
        description="Add the first thing you offer — a service is what your packages belong to."
        action={
          <Button asChild>
            <Link to="/provider/services/new">Create service</Link>
          </Button>
        }
      />
    )
  }

  return (
    <ul className="space-y-3">
      {services.data.items.map((service) => {
        // Only counted once packages have genuinely loaded, so the number is
        // never a guess.
        const packageCount = packages.data?.items.filter(
          (item) => item.serviceId === service.id,
        ).length

        return (
          <li key={service.id}>
            <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-body-lg font-medium text-ink">{service.name}</p>
                {service.description ? (
                  <p className="line-clamp-2 text-body text-ink-muted">{service.description}</p>
                ) : null}
                <p className="pt-0.5 text-small text-ink-subtle">
                  {packages.isPending
                    ? 'Counting packages…'
                    : packageCount === undefined
                      ? 'Packages unavailable'
                      : packageCount === 1
                        ? '1 package'
                        : `${packageCount} packages`}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <Button asChild variant="secondary" size="sm">
                  <Link to={`/provider/services/${service.id}/edit`}>Edit</Link>
                </Button>
              </div>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
