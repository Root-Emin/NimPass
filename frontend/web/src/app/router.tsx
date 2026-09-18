import { createBrowserRouter, redirect } from 'react-router-dom'

import { RootLayout } from '@/app/root-layout'
import { RouteErrorBoundary } from '@/app/route-error'
import { RequireSession } from '@/components/auth/require-session'
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
 * `/providers` is the public directory and `/providers/:providerRef` one
 * provider's page; the reference is the stable slug, with a UUID accepted in
 * the same position for the records that carry an id and no slug.
 *
 * Two areas are not public: the passes a wallet bought (`/passes`) and the
 * Passes it made (`/my-store`, and the form behind it). Both sit behind
 * `RequireSession`, so without a backend-verified session the area is not
 * rendered at all — no headings, no navigation, no empty collection. The guard
 * is pathless, so the URL survives and the page appears as soon as the session
 * does (§81).
 *
 * The landing page is eager because it is the most common first paint; every
 * other page is code-split, and the selling side loads only for people who
 * actually open it.
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
      // Static before dynamic: `/providers` is the directory, and every other
      // segment in that position is one provider's public page.
      {
        path: 'providers',
        lazy: async () => ({ Component: (await import('@/pages/providers')).ProvidersPage }),
      },
      {
        path: 'providers/:providerRef',
        lazy: async () => ({
          Component: (await import('@/pages/provider-detail')).ProviderDetailPage,
        }),
      },
      {
        path: 'pass/:id',
        lazy: async () => ({
          Component: (await import('@/pages/public-pass')).PublicPassPage,
        }),
      },
      {
        path: 'packages/:id',
        loader: ({ params }: { params: { id?: string } }) => redirect(`/pass/${params.id}`),
      },
      {
        path: 'packages',
        loader: () => redirect('/discover'),
      },
      { element: <RequireSession intent="purchase" />, children: [{ path: 'purchases/:id', lazy: async () => ({ Component: (await import('@/pages/purchase')).PurchasePage }) }] },
      // Everything a customer owns. The guard is pathless, so the URL is
      // untouched and a deep-linked pass renders itself as soon as the session
      // exists (docs/02-USER-FLOWS.md §6).
      {
        element: <RequireSession intent="passes" />,
        children: [
          {
            path: 'passes',
            lazy: async () => ({ Component: (await import('@/pages/my-passes')).MyPassesPage }),
          },
          // Static before dynamic for readability; React Router ranks it that
          // way regardless, so /passes/history is never swallowed by
          // /passes/:id.
          {
            path: 'passes/history',
            lazy: async () => ({
              Component: (await import('@/pages/pass-history')).PassHistoryPage,
            }),
          },
          {
            path: 'passes/:id',
            lazy: async () => ({ Component: (await import('@/pages/pass-detail')).PassDetailPage }),
          },
        ],
      },
      // The account page. Public like every other route — it renders an
      // explanation rather than a redirect when nobody is signed in, and every
      // byte of real data behind it is authorised server-side
      // (docs/09-SECURITY.md §37).
      {
        path: 'profile',
        lazy: async () => ({ Component: (await import('@/pages/profile')).ProfilePage }),
      },

      // Selling. Signed out there is nothing to manage, so none of it renders.
      //
      // Still no workspace: My Store is an ordinary page listing the Passes
      // this wallet made, and the form beside it is the whole of creating one —
      // a Pass derives its own service and carries its own publish step, so
      // nothing has to be set up first.
      {
        element: <RequireSession intent="provider" />,
        children: [
          {
            path: 'my-store',
            lazy: async () => ({ Component: (await import('@/pages/my-store')).MyStorePage }),
          },
          // Where the provider area used to live. Real, linkable destinations,
          // so they redirect rather than 404.
          {
            path: 'provider',
            loader: () => redirect('/my-store'),
            element: null,
          },
          {
            path: 'provider/passes',
            loader: () => redirect('/my-store'),
          },
          {
            path: 'provider/passes/new',
            lazy: async () => {
              const { PassFormPage } = await import('@/pages/provider/pass-form')
              return { Component: () => <PassFormPage mode="create" /> }
            },
          },
          {
            path: 'provider/passes/:id/edit',
            lazy: async () => {
              const { PassFormPage } = await import('@/pages/provider/pass-form')
              return { Component: () => <PassFormPage mode="edit" /> }
            },
          },
          { path: 'provider/redeem', loader: () => redirect('/my-store') },
          { path: 'provider/services', loader: () => redirect('/my-store') },
          { path: 'provider/services/new', loader: () => redirect('/provider/passes/new') },
          { path: 'provider/services/:id/edit', loader: () => redirect('/my-store') },
          { path: 'provider/profile', loader: () => redirect('/my-store') },
          { path: 'provider/sold', loader: () => redirect('/my-store') },
          { path: 'provider/packages', loader: () => redirect('/my-store') },
          { path: 'provider/packages/new', loader: () => redirect('/provider/passes/new') },
          {
            path: 'provider/packages/:id/edit',
            loader: ({ params }: { params: { id?: string } }) =>
              redirect(`/provider/passes/${params.id}/edit`),
          },
        ],
      },

      // Eager: the error boundary renders it too, so splitting it buys nothing.
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
