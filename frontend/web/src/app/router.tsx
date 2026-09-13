import { createBrowserRouter } from 'react-router-dom'

import { RootLayout } from '@/app/root-layout'
import { RouteErrorBoundary } from '@/app/route-error'
import { HomePage } from '@/pages/home'
import { NotFoundPage } from '@/pages/not-found'

/**
 * Route tree (docs/08-ARCHITECTURE.md §79).
 *
 * Public routes are shareable URLs (§80) and deep links land on their
 * destination rather than being bounced through the homepage (§81,
 * docs/02-USER-FLOWS.md §6). Knowing a pass URL grants nothing — authorisation
 * is always decided by the backend (docs/09-SECURITY.md §37).
 *
 * The landing page is eager because it is the most common first paint; every
 * other page is code-split, and the whole provider workspace loads only for
 * people who actually open it.
 */
export const routes = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'discover',
        lazy: async () => ({ Component: (await import('@/pages/discover')).DiscoverPage }),
      },
      {
        path: 'providers/:providerId',
        lazy: async () => ({
          Component: (await import('@/pages/provider-detail')).ProviderDetailPage,
        }),
      },
      {
        path: 'packages/:id',
        lazy: async () => ({
          Component: (await import('@/pages/package-detail')).PackageDetailPage,
        }),
      },
      {
        path: 'passes',
        lazy: async () => ({ Component: (await import('@/pages/my-passes')).MyPassesPage }),
      },
      {
        path: 'passes/:id',
        lazy: async () => ({ Component: (await import('@/pages/pass-detail')).PassDetailPage }),
      },

      // Provider workspace.
      {
        path: 'provider',
        lazy: async () => ({ Component: (await import('@/pages/provider/layout')).ProviderLayout }),
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('@/pages/provider/overview')).ProviderOverviewPage,
            }),
          },
          {
            path: 'profile',
            lazy: async () => ({
              Component: (await import('@/pages/provider/profile')).ProviderProfilePage,
            }),
          },
          {
            path: 'services',
            lazy: async () => ({
              Component: (await import('@/pages/provider/services')).ProviderServicesPage,
            }),
          },
          {
            path: 'services/new',
            lazy: async () => {
              const { ServiceFormPage } = await import('@/pages/provider/service-form')
              return { Component: () => <ServiceFormPage mode="create" /> }
            },
          },
          {
            path: 'services/:id/edit',
            lazy: async () => {
              const { ServiceFormPage } = await import('@/pages/provider/service-form')
              return { Component: () => <ServiceFormPage mode="edit" /> }
            },
          },
          {
            path: 'packages',
            lazy: async () => ({
              Component: (await import('@/pages/provider/packages')).ProviderPackagesPage,
            }),
          },
          {
            path: 'packages/new',
            lazy: async () => {
              const { PackageFormPage } = await import('@/pages/provider/package-form')
              return { Component: () => <PackageFormPage mode="create" /> }
            },
          },
          {
            path: 'packages/:id/edit',
            lazy: async () => {
              const { PackageFormPage } = await import('@/pages/provider/package-form')
              return { Component: () => <PackageFormPage mode="edit" /> }
            },
          },
          {
            path: 'passes',
            lazy: async () => ({
              Component: (await import('@/pages/provider/passes')).ProviderPassesPage,
            }),
          },
          {
            path: 'redeem',
            lazy: async () => ({
              Component: (await import('@/pages/provider/redeem')).ProviderRedeemPage,
            }),
          },
        ],
      },

      // Eager: the error boundary renders it too, so splitting it buys nothing.
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
