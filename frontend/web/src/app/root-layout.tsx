import { Outlet, ScrollRestoration } from 'react-router-dom'

import { AppShell } from '@/components/layout/app-shell'

export function RootLayout() {
  return (
    <AppShell>
      <Outlet />
      <ScrollRestoration />
    </AppShell>
  )
}
