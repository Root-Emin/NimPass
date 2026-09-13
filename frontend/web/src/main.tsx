import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { AppProviders } from '@/app/providers'
import { router } from '@/app/router'
import { applyDocumentLanguage } from '@/lib/nimiq'
import '@/styles/index.css'

// Nimiq Pay's language takes precedence over the device's where Nimpass
// supports it (docs/04-NIMIQ-MINI-APPS.md §33). Runs before the first render,
// which the host context allows: it is seeded before page scripts.
applyDocumentLanguage()

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
