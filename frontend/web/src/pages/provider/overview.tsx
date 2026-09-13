import { ArrowRight, Check, Package, UserRound, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'

import { WorkspaceHeader } from '@/components/layout/provider-shell'
import { WorkspaceGate } from '@/components/provider/workspace-gate'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { useMyPackages, useMyProviderProfile, useMyServices } from '@/hooks/use-provider-workspace'
import { cn } from '@/lib/utils'

/**
 * The workspace landing.
 *
 * Deliberately not an analytics dashboard (docs/03-DESIGN-SYSTEM.md §64-§65,
 * milestone brief §13): no revenue, customer or volume figures are shown,
 * because no backend has reported any. What it shows instead is the provider's
 * real setup state and the next action that follows from it.
 */
export function ProviderOverviewPage() {
  return (
    <>
      <WorkspaceHeader
        title="Overview"
        description="Set up what you sell, publish it, and get paid in NIM straight to your own wallet."
      />
      <div className="mt-8">
        <WorkspaceGate>
          <OverviewContent />
        </WorkspaceGate>
      </div>
    </>
  )
}

function OverviewContent() {
  const profile = useMyProviderProfile()
  const services = useMyServices()
  const packages = useMyPackages()

  const isPending = profile.isPending || services.isPending || packages.isPending
  const failed = profile.error ?? services.error ?? packages.error

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    )
  }

  if (failed) {
    return (
      <ErrorState
        error={failed}
        onRetry={() => {
          void profile.refetch()
          void services.refetch()
          void packages.refetch()
        }}
      />
    )
  }

  const serviceCount = services.data?.items.length ?? 0
  const packageList = packages.data?.items ?? []
  const activeCount = packageList.filter((item) => item.status === 'ACTIVE').length

  // Each step is derived from data the backend returned, not assumed.
  const steps = [
    {
      id: 'profile',
      icon: UserRound,
      title: 'Name your provider profile',
      body: 'The name customers see on your packages. It is the whole public profile the API supports today.',
      done: Boolean(profile.data?.name),
      to: '/provider/profile',
      cta: 'Edit profile',
    },
    {
      id: 'service',
      icon: Wrench,
      title: 'Add a service',
      body: 'A service is what you offer — personal training, guitar lessons, coaching.',
      done: serviceCount > 0,
      to: '/provider/services/new',
      cta: 'Create service',
    },
    {
      id: 'package',
      icon: Package,
      title: 'Create a package',
      body: 'A package is a bundle of sessions for one of your services, priced in NIM.',
      done: packageList.length > 0,
      to: '/provider/packages/new',
      cta: 'Create package',
    },
    {
      id: 'publish',
      icon: ArrowRight,
      title: 'Publish it',
      body: 'Published packages appear in Discover and can be bought straight away.',
      done: activeCount > 0,
      to: '/provider/packages',
      cta: 'Go to packages',
    },
  ]

  const nextStep = steps.find((step) => !step.done)

  return (
    <div className="space-y-8">
      {profile.data?.name ? (
        <p className="text-body-lg text-ink">
          Welcome back, <span className="font-medium">{profile.data.name}</span>.
        </p>
      ) : null}

      <section>
        <h2 className="text-h3 text-ink">
          {nextStep ? 'Finish setting up' : 'Your workspace'}
        </h2>
        <ol className="mt-4 space-y-3">
          {steps.map((step) => (
            <li key={step.id}>
              <Card
                className={cn(
                  'flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between',
                  step.done && 'bg-surface-muted shadow-none',
                )}
              >
                <div className="flex min-w-0 gap-3.5">
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-md',
                      step.done ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent',
                    )}
                  >
                    {step.done ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <step.icon className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-body-lg font-medium text-ink">{step.title}</p>
                    <p className="text-body text-ink-muted">{step.body}</p>
                  </div>
                </div>

                <div className="shrink-0 sm:pl-4">
                  <Button
                    asChild
                    size="sm"
                    variant={step.id === nextStep?.id ? 'primary' : 'secondary'}
                  >
                    <Link to={step.to}>{step.done ? 'Review' : step.cta}</Link>
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-h3 text-ink">What you have so far</h2>
        {/* Real counts from real queries. Nothing is estimated or invented. */}
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <CountCard label="Services" value={serviceCount} to="/provider/services" />
          <CountCard label="Packages" value={packageList.length} to="/provider/packages" />
          <CountCard label="Published" value={activeCount} to="/provider/packages" />
        </dl>
      </section>
    </div>
  )
}

function CountCard({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Card className="p-5">
      <Link to={to} className="block">
        <dt className="text-small text-ink-muted">{label}</dt>
        <dd className="mt-1 font-display text-h1 font-semibold tabular-nums text-ink">{value}</dd>
      </Link>
    </Card>
  )
}
