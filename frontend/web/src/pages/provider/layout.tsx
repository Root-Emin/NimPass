import { Outlet } from 'react-router-dom'

import { ProviderShell } from '@/components/layout/provider-shell'
import { useMyProviderProfile } from '@/hooks/use-provider-workspace'

/**
 * Frame for every `/provider/*` screen. The public-profile link only appears
 * once the backend has told us which provider this is; there are no slugs in
 * the contract, so it points at the provider id.
 */
export function ProviderLayout() {
  const profile = useMyProviderProfile()

  return (
    <ProviderShell publicProviderId={profile.data?.id ?? null}>
      <Outlet />
    </ProviderShell>
  )
}
