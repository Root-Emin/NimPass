import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { anOffer, aPackage, mockApi, ok } from '@/test/mock-api'
import { renderApp } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * jsdom has no Nimiq provider, so every test here runs in the ordinary-browser
 * runtime: the page must be fully readable, and only the CTA is gated.
 */
const OFFER = anOffer()
const PKG_ID = OFFER.package.id

describe('Package detail', () => {
  it('answers the buying questions without a wallet', async () => {
    mockApi({ [`/api/v1/public/packages/${PKG_ID}`]: () => ok(OFFER) })

    renderApp(`/packages/${PKG_ID}`)

    expect(
      await screen.findByRole('heading', { name: '10 Personal Training Sessions', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Alex Fitness').length).toBeGreaterThan(0)
    expect(screen.getByText('Provided by')).toBeInTheDocument()
    expect(screen.getByText('Ten one-to-one sessions.')).toBeInTheDocument()
    expect(screen.getAllByText('250 NIM').length).toBeGreaterThan(0)
    expect(screen.getByText('25 NIM per session')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "What you'll get" })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'After you buy' })).toBeInTheDocument()
  })

  it('gates the purchase CTA and names the next step', async () => {
    mockApi({ [`/api/v1/public/packages/${PKG_ID}`]: () => ok(OFFER) })

    renderApp(`/packages/${PKG_ID}`)

    const buyButtons = await screen.findAllByRole('button', { name: /Buy with NIM/i })
    for (const button of buyButtons) expect(button).toBeDisabled()

    expect(
      screen.getAllByText('Open Nimpass in Nimiq Pay to buy this package.').length,
    ).toBeGreaterThan(0)
  })

  it('claims no payment result before one exists', async () => {
    mockApi({ [`/api/v1/public/packages/${PKG_ID}`]: () => ok(OFFER) })

    renderApp(`/packages/${PKG_ID}`)
    await screen.findByRole('heading', { name: '10 Personal Training Sessions', level: 1 })

    expect(screen.queryByText(/Payment successful/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Your pass is ready/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View pass' })).not.toBeInTheDocument()
  })

  it('marks an unpublished package as unavailable rather than buyable', async () => {
    mockApi({
      [`/api/v1/public/packages/${PKG_ID}`]: () =>
        ok(anOffer({ package: aPackage({ status: 'UNAVAILABLE' }) })),
    })

    renderApp(`/packages/${PKG_ID}`)

    const unavailable = await screen.findAllByRole('button', { name: 'Not available' })
    expect(unavailable[0]).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Buy with NIM/i })).not.toBeInTheDocument()
  })

  it('links back to the provider so a deep-linked visitor can explore', async () => {
    mockApi({ [`/api/v1/public/packages/${PKG_ID}`]: () => ok(OFFER) })

    renderApp(`/packages/${PKG_ID}`)
    await screen.findByRole('heading', { name: '10 Personal Training Sessions', level: 1 })

    const links = screen.getAllByRole('link', { name: /Alex Fitness/ })
    expect(links[0]).toHaveAttribute('href', `/providers/${OFFER.provider.id}`)
  })
})
