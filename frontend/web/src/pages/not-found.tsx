import { Link } from 'react-router-dom'

import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/states'

export function NotFoundPage() {
  return (
    <Page width="reading">
      <EmptyState
        title="Page not found"
        description="The link may be broken, or the page may have moved."
        action={
          <Button asChild>
            <Link to="/discover">Go to Discover</Link>
          </Button>
        }
      />
    </Page>
  )
}
