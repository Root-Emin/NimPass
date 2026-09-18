import { Link } from 'react-router-dom'

import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { useIsAuthenticated } from '@/hooks/use-session'

/**
 * A wrong turn should still look like Nimpass, and should point somewhere
 * useful rather than apologise at length (docs/03-DESIGN-SYSTEM.md §99, §106).
 */
export function NotFoundPage() {
  // My Passes is only a useful way out for someone who owns passes; a visitor
  // without a session would land on a login prompt instead of a page.
  const isAuthenticated = useIsAuthenticated()

  return (
    <Page width="reading" className="py-24 text-center sm:py-32">
      <p className="eyebrow text-ink-subtle">404</p>
      <h1 className="mt-4 text-h1 text-ink">Page not found</h1>
      <p className="mx-auto mt-4 max-w-md text-pretty text-lead text-ink-muted">
        The link may be broken, or the page may have moved.
      </p>
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link to="/discover">Go to Discover</Link>
        </Button>
        {isAuthenticated ? (
          <Button asChild size="lg" variant="secondary">
            <Link to="/passes">My Passes</Link>
          </Button>
        ) : null}
      </div>
    </Page>
  )
}
