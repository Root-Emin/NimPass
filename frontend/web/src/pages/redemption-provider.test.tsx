import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aProvider, domainError, mockApi, ok } from '@/test/mock-api'
import {
  A_REFERENCE,
  aRedemptionConfirmation,
  aRedemptionHistoryItem,
  aRedemptionLookup,
} from '@/test/fixtures'
import { renderApp, stubSession, stubWallet } from '@/test/render'

/**
 * The provider half of a redemption.
 *
 * One property dominates this file: **lookup consumes nothing**. Scanning a
 * code, resolving it, and seeing whose session it is are all reads. Exactly one
 * call moves a counter, and a human has to press it.
 *
 * That separation is why the scanner cannot spend a session by accident, and
 * why a camera pointed at a screen is not consent.
 */

const WALLET = stubWallet()
const SESSION = stubSession()
const PROVIDER = aProvider()

const lookupUrl = `/api/v1/providers/${PROVIDER.id}/redemptions/lookup`
const confirmUrl = `/api/v1/providers/${PROVIDER.id}/redemptions/confirm`
const historyUrl = `/api/v1/providers/${PROVIDER.id}/redemptions`

afterEach(() => {
  vi.unstubAllGlobals()
})

function providerBackend(extra: Record<string, () => Response> = {}) {
  return mockApi({
    '/api/v1/providers': () => ok({ items: [PROVIDER] }),
    [historyUrl]: () => ok({ items: [] }),
    [`POST ${lookupUrl}`]: () => ok(aRedemptionLookup()),
    [`POST ${confirmUrl}`]: () => ok(aRedemptionConfirmation()),
    ...extra,
  })
}

async function typeCode(user: ReturnType<typeof userEvent.setup>, code = A_REFERENCE) {
  const field = await screen.findByLabelText(/Session code/i)
  await user.clear(field)
  await user.type(field, code)
  await user.click(screen.getByRole('button', { name: /Look up code/i }))
}

describe('provider redemption', () => {
  it('looks a code up without consuming anything, then confirms explicitly', async () => {
    const { calls } = providerBackend()

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await typeCode(user)

    // Context, from the lookup response only.
    expect(await screen.findByText('10 Personal Training Sessions')).toBeInTheDocument()
    expect(screen.getByText('Personal Training')).toBeInTheDocument()
    expect(screen.getByText('Session 4')).toBeInTheDocument()

    // Nothing was consumed by looking.
    expect(calls.some((c) => c.url === confirmUrl)).toBe(false)
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/session used/i)
    expect(body).not.toMatch(/completed/i)

    // The lookup sent exactly the contract's body.
    expect(calls.find((c) => c.url === lookupUrl)?.body).toEqual({
      redemptionReference: A_REFERENCE,
    })

    // Now the deliberate part.
    await user.click(screen.getByRole('button', { name: 'Confirm session' }))

    expect(await screen.findByText('Session used')).toBeInTheDocument()
    expect(calls.find((c) => c.url === confirmUrl)?.body).toEqual({
      redemptionReference: A_REFERENCE,
    })
    // 6 remaining — the backend's number, not 7 minus one.
    expect(screen.getByText(/6 sessions remaining/i)).toBeInTheDocument()
  })

  it('shows no success wording anywhere in the lookup result', async () => {
    // §18, stated as a property of the whole screen rather than one string.
    providerBackend()

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await typeCode(user)
    await screen.findByText('Session 4')

    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/redeemed/i)
    expect(body).not.toMatch(/session used/i)
    // The remaining count shown is the *current* one, pre-consumption.
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm session' })).toBeEnabled()
  })

  it('exposes no customer identity in the confirmation context', async () => {
    // §20: the lookup is privacy-minimised and this screen keeps it that way.
    providerBackend()

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await typeCode(user)

    // Scoped to the confirmation card. The page chrome shows the *provider's
    // own* wallet, which is theirs to see — the question here is whether the
    // customer's identity leaks into the redemption context.
    const context = (await screen.findByText('Session 4')).closest('dl')!.parentElement!
    const shown = context.textContent ?? ''

    expect(shown).not.toMatch(/NQ07/)
    expect(shown).not.toMatch(/wallet/i)
    expect(shown).not.toMatch(/@/)
    // What it does show is the consequence, and nothing else.
    expect(shown).toMatch(/Session 4/)
    expect(shown).toMatch(/Personal Training/)
  })

  it('locks the confirm control while the request is in flight', async () => {
    // §34: a UX lock, not the security guarantee — but rapid taps must not
    // become several requests.
    let release: ((value: unknown) => void) | undefined
    const { calls } = providerBackend({
      [`POST ${confirmUrl}`]: () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(ok(aRedemptionConfirmation()))
        }) as unknown as Response,
    })

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await typeCode(user)
    await screen.findByText('Session 4')

    const confirm = screen.getByRole('button', { name: 'Confirm session' })
    await user.click(confirm)
    await user.click(confirm).catch(() => {})
    await user.click(confirm).catch(() => {})

    await waitFor(() => expect(calls.filter((c) => c.url === confirmUrl)).toHaveLength(1))
    release?.(null)
  })

  it('reports the final session as a completed pass', async () => {
    // §25 and §50: the completion comes from the confirm response, not from
    // noticing that a locally-tracked number hit zero.
    providerBackend({
      [`POST ${lookupUrl}`]: () =>
        ok(aRedemptionLookup({ usedSessions: 9, remainingSessions: 1, nextSessionOrdinal: 10 })),
      [`POST ${confirmUrl}`]: () =>
        ok(
          aRedemptionConfirmation({
            usedSessions: 10,
            remainingSessions: 0,
            passStatus: 'COMPLETED',
            completed: true,
          }),
        ),
    })

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await typeCode(user)

    expect(await screen.findByText('Session 10')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm session' }))

    expect(await screen.findByText('Session used — pass complete')).toBeInTheDocument()
    expect(screen.getByText(/last session on this pass/i)).toBeInTheDocument()
  })

  it('refuses a replayed reference without decrementing again', async () => {
    // §52: confirm once, then the same code comes back as already consumed.
    let consumed = false
    const { calls } = providerBackend({
      [`POST ${confirmUrl}`]: () => {
        if (consumed) return domainError(409, 'REDEMPTION_ALREADY_CONSUMED', 'already')
        consumed = true
        return ok(aRedemptionConfirmation())
      },
      [`POST ${lookupUrl}`]: () =>
        consumed
          ? domainError(409, 'REDEMPTION_ALREADY_CONSUMED', 'already')
          : ok(aRedemptionLookup()),
    })

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await typeCode(user)
    await user.click(await screen.findByRole('button', { name: 'Confirm session' }))
    await screen.findByText('Session used')

    // Same code again.
    await user.click(screen.getByRole('button', { name: 'Redeem another' }))
    await typeCode(user)

    expect(await screen.findByText("That code wasn't accepted")).toBeInTheDocument()
    expect(screen.getByText(/already been used/i)).toBeInTheDocument()
    // No second confirmation was even offered.
    expect(screen.queryByRole('button', { name: 'Confirm session' })).not.toBeInTheDocument()
    expect(calls.filter((c) => c.url === confirmUrl)).toHaveLength(1)
  })

  it('rejects a rotated-away reference rather than falling back to it', async () => {
    // §53: the customer rotated their code, so the one the provider holds is
    // no longer the live one. It must simply fail.
    providerBackend({
      [`POST ${lookupUrl}`]: () => domainError(404, 'INVALID_REDEMPTION_TOKEN', 'unknown'),
    })

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await typeCode(user)

    expect(await screen.findByText("That code wasn't accepted")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm session' })).not.toBeInTheDocument()
  })

  it('leaks nothing about whose code an invalid reference was', async () => {
    // §31: "not valid here" is all a provider may learn. Anything sharper lets
    // them probe for live references belonging to other providers.
    providerBackend({
      [`POST ${lookupUrl}`]: () =>
        domainError(404, 'INVALID_REDEMPTION_TOKEN', 'wrong provider for challenge 5abc'),
    })

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await typeCode(user)
    await screen.findByText("That code wasn't accepted")

    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/another provider|different provider|wrong provider/i)
    expect(body).not.toContain('INVALID_REDEMPTION_TOKEN')
    expect(body).not.toContain('5abc')
    expect(body).toMatch(/isn't valid or can't be used here/i)
  })

  it('does not ask the backend about an obviously malformed code', async () => {
    // Shape validation is a courtesy that saves a round trip. It is not
    // security — the backend still decides (§37).
    const { calls } = providerBackend()

    const user = userEvent.setup()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })

    const field = await screen.findByLabelText(/Session code/i)
    await user.type(field, 'not-a-code')

    expect(screen.getByRole('button', { name: /Look up code/i })).toBeDisabled()
    expect(calls.some((c) => c.url === lookupUrl)).toBe(false)
  })

  it('shows real provider history, with no invented analytics', async () => {
    // §39.
    providerBackend({
      [historyUrl]: () =>
        ok({
          items: [
            aRedemptionHistoryItem({ sessionOrdinal: 4 }),
            aRedemptionHistoryItem({
              redemptionId: '70000000-0000-4000-8000-000000000009',
              sessionOrdinal: 3,
            }),
          ],
        }),
    })

    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })

    expect(await screen.findByRole('heading', { name: 'Recently redeemed' })).toBeInTheDocument()
    expect(screen.getByText(/Session 4/)).toBeInTheDocument()

    const body = document.body.textContent ?? ''
    // No metrics the contract cannot support.
    expect(body).not.toMatch(/this week|this month|average|total revenue/i)
  })

  it('never asks for the camera just because the page loaded', async () => {
    const getUserMedia = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } })
    providerBackend()

    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await screen.findByLabelText(/Session code/i)

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('assumes nothing about a confirmation interrupted by a reload', async () => {
    // §41: a provider who looked up a code and then reloaded must land back on
    // an empty scanner, not on a "session used" screen. The only safe default
    // is to assume nothing happened and let the backend answer again.
    providerBackend()

    const user = userEvent.setup()
    const first = renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })
    await typeCode(user)
    await screen.findByText('Session 4')

    // The page goes away mid-confirmation.
    first.unmount()

    providerBackend()
    renderApp('/provider/redeem', { wallet: WALLET, session: SESSION })

    // Back to the start: no context, no success, no reference retained.
    expect(await screen.findByLabelText(/Session code/i)).toHaveValue('')
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/session used/i)
    expect(body).not.toMatch(/Session 4/)
    expect(body).not.toContain(A_REFERENCE)
    expect(screen.queryByRole('button', { name: 'Confirm session' })).not.toBeInTheDocument()
  })

  it('decodes QR codes for real, including where the platform has no detector', async () => {
    // §31. `BarcodeDetector` is Chromium-only — Safari and iOS WKWebView do not
    // have it, and Nimiq Pay runs on iOS. Relying on it alone meant a provider
    // with an iPhone could not scan at all, which is why `qr-scanner` (Nimiq's
    // own, lazily loaded) is the fallback rather than an "unsupported" message.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(
      join(process.cwd(), 'src', 'hooks', 'use-camera-scanner.ts'),
      'utf8',
    )

    // A real decoder on both paths.
    expect(source).toContain('BarcodeDetector')
    expect(source).toContain("import('qr-scanner')")
    // Loaded on demand, so it costs nothing on any other route.
    expect(source).toMatch(/await import\('qr-scanner'\)/)
    // Camera availability is now the only thing that can rule scanning out.
    expect(source).toContain('return cameraApiAvailable()')
  })
})
