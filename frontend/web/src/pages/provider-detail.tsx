import { MapPin } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { Section, SectionHeader } from '@/components/layout/page'
import { PassGrid } from '@/components/catalog/pass-grid'
import { ProviderAvatar } from '@/components/provider/provider-avatar'
import { MarkField } from '@/components/ui/mark'
import { ShareButton } from '@/components/ui/share-button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { providerUrl } from '@/lib/provider-url'
import {
  usePublicProvider,
  usePublicProviderBySlug,
  usePublicProviderPasses,
} from '@/hooks/use-catalog'

/**
 * A public storefront (docs/03-DESIGN-SYSTEM.md §38).
 *
 * `PublicProvider` carries name, headline, bio, location and an avatar URL, and
 * each one is rendered only if the provider actually filled it in — the empty
 * string is the contract's "not set", and an empty headline must not become a
 * placeholder sentence (docs/08-ARCHITECTURE.md §11). The banner stays a colour
 * field derived from the name, so a profile with no image still has an
 * identity.
 *
 * The face is the owner's Nimiq identicon, with an uploaded photograph on top
 * when they have set one. The payout wallet stays off the page
 * (docs/09-SECURITY.md §79).
 *
 * Addressed by the stable slug (docs/08-ARCHITECTURE.md §80) — assigned once at
 * creation, unchanged by a rename, so a shared link keeps working. A UUID in
 * the same position still resolves, because a `Pass` carries a provider id and
 * no slug; the route accepts both rather than making the pass page guess.
 */

/** Exactly the shape `format: uuid` describes; anything else is a slug. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function ProviderDetailPage() {
  const { providerRef } = useParams<{ providerRef: string }>()
  const isId = Boolean(providerRef && UUID.test(providerRef))

  // Only one of the two ever runs: the other is disabled by an undefined key.
  const byId = usePublicProvider(isId ? providerRef : undefined)
  const bySlug = usePublicProviderBySlug(isId ? undefined : providerRef)
  const provider = isId ? byId : bySlug

  // The pass list is filtered on the provider's id, which is known only
  // once the profile has resolved — a slug cannot be matched against it.
  const passes = usePublicProviderPasses(provider.data?.id)

  if (provider.isPending) return <ProviderDetailSkeleton />

  if (provider.isError) {
    return (
      <Container className="py-16">
        <ErrorState error={provider.error} onRetry={() => void provider.refetch()} />
      </Container>
    )
  }

  const profile = provider.data

  return (
    <>
      <MarkField seed={profile.name} className="h-36 sm:h-48" />

      <Container width="reading">
        {/* `relative` is load-bearing: `MarkField` is positioned, so a static
            sibling that overlaps it paints underneath — which cropped the
            identity mark to the sliver below the banner's edge. */}
        <div className="relative -mt-14 flex flex-col items-center text-center sm:-mt-16">
          <ProviderAvatar
            wallet={profile.wallet}
            avatarUrl={profile.avatarUrl}
            variant={profile.avatarVariant}
            name={profile.name}
            size={112}
            className="ring-4 ring-canvas"
          />

          <h1 className="mt-6 text-h1 text-ink">{profile.name}</h1>

          <p className="mt-3 text-body-lg text-ink-muted">
            {profile.headline || 'Sessions you can buy and use over time.'}
          </p>

          {profile.location ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-small text-ink-subtle">
              <MapPin className="size-3.5" aria-hidden="true" />
              {profile.location}
            </p>
          ) : null}

          {profile.bio ? (
            <p className="mt-5 max-w-prose text-pretty text-body text-ink-muted">{profile.bio}</p>
          ) : null}

          {/*
            The canonical provider URL, not `window.location.href`: this route
            also resolves a UUID, so a visitor who arrived through a pass's
            `providerId` would otherwise copy an id-shaped link for a provider
            who has a readable one.
          */}
          <ShareButton
            className="mt-7"
            url={providerUrl(profile)}
            copiedMessage="Provider link copied"
          />
        </div>
      </Container>

      <Container className="pb-20 sm:pb-24">
        <Section className="mt-14 sm:mt-16">
          <SectionHeader title="Available passes" description="Prepaid sessions you can buy now." />
          <PassGrid
            items={passes.data}
            isPending={passes.isPending}
            error={passes.isError ? passes.error : null}
            onRetry={() => void passes.refetch()}
            skeletonCount={3}
            emptyTitle="No passes available"
            emptyDescription={`${profile.name} hasn't published any passes yet.`}
          />
        </Section>
      </Container>
    </>
  )
}

function ProviderDetailSkeleton() {
  return (
    <>
      <Skeleton className="h-36 rounded-none sm:h-48" />
      <Container width="reading">
        <div className="relative -mt-14 flex flex-col items-center gap-4 sm:-mt-16">
          <Skeleton className="size-28 rounded-full ring-4 ring-canvas" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </Container>
    </>
  )
}
