import { WorkspaceHeader } from '@/components/layout/provider-shell'
import { WorkspaceGate } from '@/components/provider/workspace-gate'
import { Alert } from '@/components/ui/alert'
import { Info } from 'lucide-react'

/**
 * Passes customers bought from this provider.
 *
 * BACKEND CONTRACT STILL MISSING. `backend/openapi.yaml` exposes exactly one
 * pass endpoint — `GET /passes/{passID}` — and it is scoped to the pass
 * *owner*, so a provider cannot read it. There is no provider-side list.
 *
 * The screen therefore says so. An empty table here would read as "nobody has
 * bought anything", which is a different and possibly false statement
 * (docs/08-ARCHITECTURE.md §11).
 */
export function ProviderPassesPage() {
  return (
    <>
      <WorkspaceHeader
        title="Passes"
        description="Packages people bought from you, and how many sessions they have left."
      />
      <div className="mt-8">
        <WorkspaceGate>
          <Alert tone="info" icon={<Info />} title="Not available yet">
            Nimpass can't show you customer passes yet — the API has no provider-side pass
            list. Once it does, sold packages and their remaining sessions appear here.
          </Alert>
        </WorkspaceGate>
      </div>
    </>
  )
}
