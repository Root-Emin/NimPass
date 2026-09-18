import { screen, waitFor, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

export async function startPurchaseIntent(user: ReturnType<typeof userEvent.setup>) {
  const buy = (await screen.findAllByRole('button', { name: /Buy with NIM/i }))[0]!
  await user.click(buy)
}

/**
 * Mini App purchase: Buy creates the intent, then the native review/pay step.
 *
 * Only the network acknowledgement is a gate now. Confirming which account
 * Nimiq Pay has selected used to be required before Approve could be pressed;
 * the sender no longer decides whether a referenced payment settles, so it is
 * information on that screen rather than a step (ADR-013).
 */
export async function approveNativePayment(user: ReturnType<typeof userEvent.setup>) {
  await startPurchaseIntent(user)
  const sheet = await nativeCheckoutSheet()
  await user.click(within(sheet).getByRole('checkbox'))
  const approve = within(sheet).getByRole('button', { name: APPROVE_LABEL })
  await waitFor(() => expect(approve).toBeEnabled())
  await user.click(approve)
}

/**
 * The confirmation overlay a phone gets when Buy is tapped.
 *
 * It opens on the tap rather than rendering into the purchase panel at the
 * bottom of the page, so a customer never has to scroll to find the step they
 * just asked for. Tests reach into it rather than into the page behind, which
 * a modal has made inert.
 */
export function nativeCheckoutSheet() {
  return screen.findByRole('dialog', { name: 'Confirm your purchase' })
}

/** The one control that dispatches the wallet. */
export const APPROVE_LABEL = 'Confirm and pay in Nimiq Pay'
