import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aProvider, mockApi, ok } from '@/test/mock-api'
import { renderApp, stubSession, stubWallet } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WALLET = stubWallet()
const PROVIDER_ID = '00000000-0000-4000-8000-000000000002'

/**
 * Authentication and provider authorisation are separate questions
 * (docs/09-SECURITY.md §67-§68), and the workspace has to answer both.
 *
 * The failure this pins down is specific: every workspace query is gated on a
 * provider id, so if that id is sourced from something the backend does not
 * supply, the queries never run — and a disabled react-query query reports
 * `isPending` forever, which renders as a skeleton that never resolves.
 */
describe('provider workspace access', () => {
  it('explains itself to a signed-in customer instead of loading forever', async () => {
    // Authenticated, but this identity owns no provider record.
    mockApi({ '/api/v1/providers': () => ok({ items: [] }) })

    renderApp('/provider', {
      wallet: WALLET,
      session: stubSession(),
    })

    expect(
      await screen.findByText("You don't have a provider account yet"),
    ).toBeInTheDocument()

    // Not a spinner, not an error, and not an empty workspace implying they
    // have zero of everything.
    expect(screen.queryByText('Add a service')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not crash the profile form when there is no provider record', async () => {
    mockApi({ '/api/v1/providers': () => ok({ items: [] }) })

    renderApp('/provider/profile', {
      wallet: WALLET,
      session: stubSession(),
    })

    // Reading `.displayName` off a null record here used to be a blank error
    // page rather than a message.
    expect(
      await screen.findByText("You don't have a provider account yet"),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument()
  })

  it('loads the workspace from the provider record the backend returns', async () => {
    // The session carries no provider id at all — the provider list is the
    // authority on which providers this identity owns.
    mockApi({
      '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
      [`/api/v1/providers/${PROVIDER_ID}/packages`]: () => ok({ items: [] }),
    })

    renderApp('/provider', {
      wallet: WALLET,
      session: stubSession(),
    })

    expect(await screen.findByText('Add a service')).toBeInTheDocument()
  })

  it('scopes provider reads to the id the backend reported, not one the client picked', async () => {
    const { calls } = mockApi({
      '/api/v1/providers': () => ok({ items: [aProvider({ id: PROVIDER_ID })] }),
      [`/api/v1/providers/${PROVIDER_ID}/services`]: () => ok({ items: [] }),
      [`/api/v1/providers/${PROVIDER_ID}/packages`]: () => ok({ items: [] }),
    })

    renderApp('/provider', {
      wallet: WALLET,
      // The session carries no provider id at all; the record decides.
      session: stubSession(),
    })

    await screen.findByText('Add a service')

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes(`/providers/${PROVIDER_ID}/services`))).toBe(
        true,
      ),
    )
    expect(calls.every((call) => !call.url.includes('undefined'))).toBe(true)
  })
})
