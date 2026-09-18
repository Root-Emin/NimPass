import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aPublicPass, mockApi, ok } from '@/test/mock-api'
import { renderApp } from '@/test/render'

const OFFER = aPublicPass()
const PROVIDER = OFFER.provider

const writeText = vi.fn<(value: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
})

/**
 * Installs the clipboard spy.
 *
 * Called *after* `userEvent.setup()`, which installs a clipboard stub of its
 * own — defining ours first would simply be replaced by it, and every
 * assertion here would then be about user-event's implementation rather than
 * about what the button does.
 */
function spyOnClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

/**
 * Share on a provider page means one thing: put this provider's link on the
 * clipboard and say so.
 *
 * It used to open the system share sheet wherever one existed — which is most
 * of the time inside the Nimiq Pay WebView. That is a chooser standing between
 * a provider and the only thing they wanted, and a dismissed sheet is
 * indistinguishable from a failed one, so the button often appeared to do
 * nothing at all.
 *
 * The URL is the canonical one, built from the current origin plus the stable
 * slug. That matters because this route also resolves a UUID: a visitor who
 * arrived from a pass's `providerId` is standing on `/providers/<uuid>`, and
 * copying the address bar would hand out the ugly link for a provider who has
 * a readable one.
 */
describe('sharing a provider', () => {
  function mountProvider(path: string) {
    mockApi({
      [`/api/v1/public/providers/by-slug/${PROVIDER.slug}`]: () => ok(PROVIDER),
      [`/api/v1/public/providers/${PROVIDER.id}`]: () => ok(PROVIDER),
      '/api/v1/public/passes': () => ok({ items: [OFFER] }),
    })
    return renderApp(path)
  }

  it('copies the canonical provider URL and confirms it', async () => {
    const user = userEvent.setup()
    spyOnClipboard()
    mountProvider(`/providers/${PROVIDER.slug}`)

    await screen.findByRole('heading', { name: PROVIDER.name, level: 1 })
    await user.click(screen.getByRole('button', { name: /Share/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/providers/${PROVIDER.slug}`,
    )

    // The confirmation: a small success message with the tick, announced
    // politely rather than interrupting.
    const toast = await screen.findByRole('status')
    expect(toast).toHaveTextContent('Provider link copied')
  })

  it('copies the slug URL even when the page was reached by id', async () => {
    const user = userEvent.setup()
    spyOnClipboard()
    mountProvider(`/providers/${PROVIDER.id}`)

    await screen.findByRole('heading', { name: PROVIDER.name, level: 1 })
    await user.click(screen.getByRole('button', { name: /Share/i }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/providers/${PROVIDER.slug}`,
      ),
    )
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining(PROVIDER.id))
  })

  it('never opens the system share sheet', async () => {
    const share = vi.fn()
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    const user = userEvent.setup()
    spyOnClipboard()
    mountProvider(`/providers/${PROVIDER.slug}`)

    await screen.findByRole('heading', { name: PROVIDER.name, level: 1 })
    await user.click(screen.getByRole('button', { name: /Share/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(share).not.toHaveBeenCalled()
    Reflect.deleteProperty(navigator, 'share')
  })

  it('falls back to a selectable prompt when the clipboard is unavailable', async () => {
    // LAN HTTP during Testnet testing on a phone is not a secure context, so
    // `writeText` throws. The person still needs the URL — and must not be told
    // it was copied when it was not.
    writeText.mockRejectedValue(new Error('not allowed'))
    const prompt = vi.fn()
    vi.stubGlobal('prompt', prompt)

    const user = userEvent.setup()
    spyOnClipboard()
    mountProvider(`/providers/${PROVIDER.slug}`)

    await screen.findByRole('heading', { name: PROVIDER.name, level: 1 })
    await user.click(screen.getByRole('button', { name: /Share/i }))

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    expect(prompt).toHaveBeenCalledWith(
      'Copy this link',
      `${window.location.origin}/providers/${PROVIDER.slug}`,
    )
    expect(screen.queryByText('Provider link copied')).not.toBeInTheDocument()
  })
})
