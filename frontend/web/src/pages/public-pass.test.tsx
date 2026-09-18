import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, aPass, mockApi, ok } from '@/test/mock-api'
import { renderApp } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * jsdom has no Nimiq provider, so every test here runs in the ordinary-browser
 * runtime: the page must be fully readable, and only the CTA is gated.
 */
const OFFER = aPublicPass()
const PKG_ID = OFFER.pass.id

describe('Pass detail', () => {
  it('answers the buying questions without a wallet', async () => {
    mockApi({ [`/api/v1/public/passes/${PKG_ID}`]: () => ok(OFFER) })

    renderApp(`/pass/${PKG_ID}`)

    expect(
      await screen.findByRole('heading', { name: '10 Personal Training Sessions', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Alex Fitness').length).toBeGreaterThan(0)
    expect(screen.getByText('Provided by')).toBeInTheDocument()
    expect(screen.getByText('Ten one-to-one sessions.')).toBeInTheDocument()
    expect(screen.getAllByText('250 NIM').length).toBeGreaterThan(0)
    expect(screen.getByText('25 NIM per session')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pass details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'After you buy' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "What you'll get" })).toBeInTheDocument()
    expect(screen.getByText('Total sessions')).toBeInTheDocument()
    expect(screen.getAllByText('Personal Training').length).toBeGreaterThan(0)
  })

  it('arms the purchase CTA in an ordinary browser, where the Hub is the wallet', async () => {
    mockApi({ [`/api/v1/public/passes/${PKG_ID}`]: () => ok(OFFER) })

    renderApp(`/pass/${PKG_ID}`)

    // jsdom has no injected provider, which is the desktop-browser runtime.
    // Buying belongs here, through the Nimiq Hub — a visitor is never told to
    // find a phone in order to pay (docs/04-NIMIQ-MINI-APPS.md §6-§8).
    const buyButtons = await screen.findAllByRole('button', { name: /Log in to buy/i })
    for (const button of buyButtons) expect(button).toBeEnabled()

    expect(
      screen.queryAllByText('Open Nimpass in Nimiq Pay to buy this pass.'),
    ).toHaveLength(0)
  })

  it('claims no payment result before one exists', async () => {
    mockApi({ [`/api/v1/public/passes/${PKG_ID}`]: () => ok(OFFER) })

    renderApp(`/pass/${PKG_ID}`)
    await screen.findByRole('heading', { name: '10 Personal Training Sessions', level: 1 })

    expect(screen.queryByText(/Payment successful/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Pass added to My Passes/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View pass' })).not.toBeInTheDocument()
  })

  it('marks an unpublished pass as unavailable rather than buyable', async () => {
    mockApi({
      [`/api/v1/public/passes/${PKG_ID}`]: () =>
        ok(aPublicPass({ pass: aPass({ status: 'UNAVAILABLE' }) })),
    })

    renderApp(`/pass/${PKG_ID}`)

    const unavailable = await screen.findAllByRole('button', { name: 'Not available' })
    expect(unavailable[0]).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Buy with NIM/i })).not.toBeInTheDocument()
  })

  it('links back to the provider by slug, so the link survives a rename', async () => {
    mockApi({ [`/api/v1/public/passes/${PKG_ID}`]: () => ok(OFFER) })

    renderApp(`/pass/${PKG_ID}`)
    await screen.findByRole('heading', { name: '10 Personal Training Sessions', level: 1 })

    const links = screen.getAllByRole('link', { name: /Alex Fitness/ })
    // The slug is assigned once and never moves (docs/08-ARCHITECTURE.md §80);
    // the id would also resolve, but it is not what a shared link should carry.
    expect(links[0]).toHaveAttribute('href', `/providers/${OFFER.provider.slug}`)
  })
})
