import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { AppShell } from '@/components/layout/app-shell'
import { Page } from '@/components/layout/page'
import { EmptyState } from '@/components/ui/states'
import { NotFoundPage } from '@/pages/not-found'

/**
 * Last line of defence for a route that throws.
 *
 * A rendering failure must still leave the user inside Nimpass rather than on a
 * blank page — "works on first try" is a competition requirement
 * (docs/06-COMPETITION.md §21).
 */
export function RouteErrorBoundary() {
  const error = useRouteError()

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />
  }

  return (
    <AppShell>
      <Page width="reading">
        <EmptyState
          title="Something went wrong"
          description="This page didn't load correctly. Reloading usually fixes it."
        />
      </Page>
    </AppShell>
  )
}
