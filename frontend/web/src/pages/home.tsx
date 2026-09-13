import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { Page, Section, SectionHeader } from '@/components/layout/page'
import { PackageGrid } from '@/components/package/package-grid'
import { Button } from '@/components/ui/button'
import { usePublicPackages } from '@/hooks/use-catalog'

/**
 * The landing and first-impression surface.
 *
 * Typography does the work rather than illustration (docs/03-DESIGN-SYSTEM.md
 * §99), and the page states the product in one sentence so a first-time visitor
 * understands Nimpass without instructions (docs/06-COMPETITION.md scoring, §21).
 *
 * Everything below the hero is real backend data. When the backend is
 * unreachable the section says so — it never falls back to sample content.
 */
export function HomePage() {
  const packages = usePublicPackages()

  return (
    <>
      <section className="border-b border-line/60 bg-gradient-to-b from-canvas-sunken/60 to-canvas">
        <Container className="flex flex-col items-center py-20 text-center sm:py-28">
          <p className="text-micro font-medium uppercase tracking-[0.1em] text-accent">
            Prepaid session passes
          </p>
          <h1 className="mt-5 max-w-3xl text-[2.5rem] leading-[1.08] tracking-[-0.03em] text-ink sm:text-display lg:text-[3.75rem] lg:leading-[1.05]">
            Buy a package once. Keep every session in one place.
          </h1>
          <p className="mt-6 max-w-xl text-body-lg text-ink-muted sm:text-lead">
            Nimpass turns prepaid packages from trainers, tutors and coaches into a
            digital pass you own — paid in NIM, counted down session by session.
          </p>
          <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg">
              <Link to="/discover">
                Discover packages
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to="/provider">Sell your sessions</Link>
            </Button>
          </div>
        </Container>
      </section>

      <Page className="pt-14 sm:pt-16">
        <Section className="mt-0">
          <SectionHeader
            title="Featured packages"
            description="Multi-session packages you can buy with NIM today."
            action={
              <Button asChild variant="link" size="sm">
                <Link to="/discover">
                  Browse all
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />

          <PackageGrid
            items={packages.data?.slice(0, 6)}
            isPending={packages.isPending}
            error={packages.isError ? packages.error : null}
            onRetry={() => void packages.refetch()}
            skeletonCount={3}
            emptyTitle="No packages yet"
            emptyDescription="New session packages will show up here as providers publish them."
          />
        </Section>

        <Section>
          <SectionHeader title="How Nimpass works" />
          <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step, index) => (
              <li key={step.title} className="space-y-2 border-t border-line pt-5">
                <span className="font-display text-small font-semibold text-accent">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="text-body-lg font-semibold text-ink">{step.title}</h3>
                <p className="text-body text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>
      </Page>
    </>
  )
}

/** Four steps is enough (docs/03-DESIGN-SYSTEM.md §101). No blockchain explainer. */
const HOW_IT_WORKS = [
  { title: 'Choose a package', body: 'Find a provider and pick how many sessions you want.' },
  { title: 'Pay with NIM', body: 'Confirm once in Nimiq Pay. The provider is paid directly.' },
  { title: 'Get your pass', body: 'Your pass appears in My Passes with every session on it.' },
  { title: 'Use sessions', body: 'Show your pass at each session. The count goes down by one.' },
] as const
