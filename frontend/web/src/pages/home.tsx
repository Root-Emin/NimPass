import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Container } from '@/components/layout/container'
import { HeroStrip, HeroWall } from '@/components/home/hero-wall'
import { ServiceTiles } from '@/components/home/service-tiles'
import { Page, Section, SectionHeader } from '@/components/layout/page'
import { PassGrid } from '@/components/catalog/pass-grid'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/components/ui/reveal'
import { usePublicPasses } from '@/hooks/use-catalog'
import { useIsAuthenticated } from '@/hooks/use-session'

/**
 * The landing and first-impression surface.
 *
 * The composition follows Luma's landing page, which docs/03-DESIGN-SYSTEM.md
 * §110 names as the page where that influence should run strongest: a centred
 * statement with the product's objects scattered around it, a grid of ways in,
 * and a closing invitation. What fills those shapes is Nimpass — passes rather
 * than event posters, categories rather than a marketplace, and the warm light
 * palette §16 fixes as the product's identity. The reference is the grammar,
 * not the skin (§3).
 *
 * A first-time visitor should be able to say what Nimpass does before
 * scrolling (docs/06-COMPETITION.md scoring, §21): one sentence, one obvious
 * action.
 *
 * Featured passes below the hero is real backend data. When the backend is
 * unreachable that section says so — it never falls back to sample content
 * (docs/08-ARCHITECTURE.md §11).
 */
export function HomePage() {
  const passes = usePublicPasses()

  return (
    <>
      <section className="relative -mt-[var(--header-offset)] overflow-hidden bg-gradient-to-b from-canvas-sunken/70 via-canvas to-canvas">
        {/* The only decorative thing on the page — see components/home/hero-wall. */}
        <HeroWall passes={passes.data} />

        <Container className="relative flex flex-col items-center pt-[calc(4rem+var(--header-offset))] pb-16 text-center sm:pt-[calc(6rem+var(--header-offset))] sm:pb-24 lg:min-h-[48rem] lg:justify-center lg:pt-[calc(7rem+var(--header-offset))] lg:pb-28">
          <h1 className="animate-rise max-w-3xl text-display text-ink">
            Buy a pass once.{' '}
            <span className="gradient-ink block">Keep every session in one place.</span>
          </h1>

          <p
            className="animate-rise mt-6 max-w-xl text-pretty text-lead text-ink-muted"
            style={{ animationDelay: '120ms' }}
          >
            Trainers, tutors and coaches sell prepaid sessions. You get a digital pass that
            counts them down — and always shows exactly what is left.
          </p>

          <div
            className="animate-rise mt-9 flex flex-col items-center gap-3 sm:flex-row sm:gap-4"
            style={{ animationDelay: '180ms' }}
          >
            <Button asChild size="xl" className="rounded-full">
              <Link to="/discover">
                Find a Pass
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="rounded-full">
              <Link to="/provider">
                Sell your sessions
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <HeroStrip passes={passes.data} />
        </Container>
      </section>

      <Page className="pt-4 sm:pt-6">
        <Section flush>
          <Reveal>
          <SectionHeader
            title="Passes you can buy now"
            description="Multi-session passes published by real providers."
            action={
              <Button asChild variant="link" size="sm">
                <Link to="/discover">
                  Browse all
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />

          <PassGrid
            items={passes.data?.slice(0, 6)}
            isPending={passes.isPending}
            error={passes.isError ? passes.error : null}
            onRetry={() => void passes.refetch()}
            skeletonCount={3}
            emptyTitle="No passes yet"
            emptyDescription="New session passes will show up here as providers publish them."
          />
          </Reveal>
        </Section>

        <Section>
          <Reveal>
            <SectionHeader
              title="Browse by service"
              description="The kinds of work people sell sessions for."
            />
            <ServiceTiles passes={passes.data} />
          </Reveal>
        </Section>

        <Section>
          {/* One reveal for the whole list rather than one per step: four
              staggered boxes would be a slideshow, and `Reveal` needs a real
              box to fade, which a `display: contents` wrapper does not
              generate. */}
          <Reveal>
            <SectionHeader title="How Nimpass works" />
            <ol className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {HOW_IT_WORKS.map((step, index) => (
                <li key={step.title} className="space-y-2.5 border-t border-line pt-5">
                  <span className="numeric font-display text-small font-semibold text-accent">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-body-lg font-semibold text-ink">{step.title}</h3>
                  <p className="text-body text-ink-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </Section>

        <ClosingInvitation />
      </Page>
    </>
  )
}

/**
 * The closing panel.
 *
 * Luma ends on a dotted world map; Nimpass ends on a field of session dots —
 * the punch row from every pass in the product, enlarged into a texture. Same
 * role in the composition, made of our own motif rather than a borrowed one.
 */
function ClosingInvitation() {
  const isAuthenticated = useIsAuthenticated()

  return (
    <Section className="relative overflow-hidden rounded-3xl bg-surface-muted px-6 py-16 text-center sm:px-12 sm:py-20">
      <div
        aria-hidden="true"
        className="dot-field pointer-events-none absolute inset-0 text-ink-subtle/45"
        style={{
          maskImage: 'radial-gradient(110% 85% at 50% 50%, #000 20%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(110% 85% at 50% 50%, #000 20%, transparent 78%)',
        }}
      />

      <Reveal className="relative mx-auto max-w-2xl">
        <h2 className="text-h1 text-ink">
          Your next ten sessions{' '}
          <span className="gradient-ink block">start with one pass.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-pretty text-body-lg text-ink-muted">
          Buy it once, use it over weeks, and never wonder how many you have left.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="rounded-full">
            <Link to="/discover">Find a Pass</Link>
          </Button>
          {/* The shortcut into the collection is for people who have one; a
              visitor with no session is offered discovery, not a login wall. */}
          {isAuthenticated ? (
            <Button asChild size="lg" variant="secondary" className="rounded-full">
              <Link to="/passes">Open My Passes</Link>
            </Button>
          ) : null}
        </div>
      </Reveal>
    </Section>
  )
}

/** Four steps is enough (docs/03-DESIGN-SYSTEM.md §101). No blockchain explainer. */
const HOW_IT_WORKS = [
  { title: 'Choose a pass', body: 'Find a provider and pick how many sessions you want.' },
  { title: 'Pay with NIM', body: 'Confirm once in Nimiq Pay. The provider is paid directly.' },
  { title: 'Get your pass', body: 'Your pass appears in My Passes with every session on it.' },
  { title: 'Use sessions', body: 'Show your pass at each session. The count goes down by one.' },
] as const
