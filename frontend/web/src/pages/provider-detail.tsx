import { useParams } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { Page, SectionHeader } from '@/components/layout/page'
import { PackageGrid } from '@/components/package/package-grid'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ShareButton } from '@/components/ui/share-button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { usePublicProvider, usePublicProviderPackages } from '@/hooks/use-catalog'
import { initialsOf } from '@/lib/format'

/**
 * A public storefront (docs/03-DESIGN-SYSTEM.md §38).
 *
 * The contract's `PublicProvider` is `{ id, name }`. There is no cover image,
 * avatar, headline, bio, location or verification badge to render, so the page
 * is an identity block and the packages — which is what a customer came for.
 * Nothing here is filled with placeholder biography
 * (docs/08-ARCHITECTURE.md §11).
 *
 * Deliberately absent even once those fields exist: follower counts, feeds and
 * engagement metrics (§38), and the payout wallet, which is an implementation
 * detail rather than public UX (docs/09-SECURITY.md §79).
 *
 * Addressed by provider id, because that is what the contract exposes. See the
 * Milestone 3.6 report on the id-versus-slug question, which docs/08 §80 still
 * answers differently.
 */
export function ProviderDetailPage() {
  const { providerId } = useParams<{ providerId: string }>()
  const provider = usePublicProvider(providerId)
  const packages = usePublicProviderPackages(providerId)

  if (provider.isPending) return <ProviderDetailSkeleton />

  if (provider.isError) {
    return (
      <Page>
        <ErrorState error={provider.error} onRetry={() => void provider.refetch()} />
      </Page>
    )
  }

  const profile = provider.data

  return (
    <>
      <Container width="reading" className="pt-12 sm:pt-16">
        <div className="flex flex-col items-center text-center">
          <Avatar className="size-24 border-4 border-canvas shadow-soft sm:size-28">
            <AvatarFallback className="bg-surface-inset text-h2">
              {initialsOf(profile.name)}
            </AvatarFallback>
          </Avatar>

          <h1 className="mt-5 text-h1 tracking-[-0.025em] text-ink">{profile.name}</h1>
          <p className="mt-2 text-body text-ink-muted">Sessions you can buy and use over time.</p>

          <ShareButton className="mt-6" title={`${profile.name} on Nimpass`} />
        </div>
      </Container>

      <Container className="pb-16 pt-12 sm:pb-20 sm:pt-16">
        <SectionHeader
          title="Available packages"
          description="Prepaid sessions you can buy now."
        />
        <PackageGrid
          items={packages.data}
          isPending={packages.isPending}
          error={packages.isError ? packages.error : null}
          onRetry={() => void packages.refetch()}
          skeletonCount={3}
          emptyTitle="No packages available"
          emptyDescription={`${profile.name} hasn't published any packages yet.`}
        />
      </Container>
    </>
  )
}

function ProviderDetailSkeleton() {
  return (
    <Container width="reading" className="pt-12 sm:pt-16">
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="size-24 rounded-full sm:size-28" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
    </Container>
  )
}
