import type { PackageDraft } from '@/pages/provider/package-form'

/**
 * Validates a package draft.
 *
 * Lives outside the component and reads the clock itself, with `now` injectable
 * so the expiry rule can be exercised against a fixed instant. Keeping the
 * impure read out of the component body also keeps the render path honestly
 * pure.
 *
 * This is a convenience for the provider, not a security boundary — the backend
 * validates and stores the truth (docs/09-SECURITY.md §75).
 */
export function validatePackageDraft(
  draft: PackageDraft,
  context: { sessionCount: number; priceLuna: number | null; now?: number },
): Partial<Record<keyof PackageDraft, string>> {
  const { sessionCount, priceLuna, now = Date.now() } = context
  const errors: Partial<Record<keyof PackageDraft, string>> = {}

  if (!draft.serviceId) errors.serviceId = 'Choose which service this package is for.'
  if (!draft.title.trim()) errors.title = 'Give the package a name.'

  // Sessions are whole numbers — never 7.4 (docs/08-ARCHITECTURE.md §76).
  if (!Number.isInteger(sessionCount) || sessionCount < 1) {
    errors.sessionCount = 'Enter a whole number of sessions, at least 1.'
  } else if (sessionCount > 500) {
    errors.sessionCount = 'That looks too high. Enter 500 or fewer.'
  }

  if (draft.priceNim.trim() === '') {
    errors.priceNim = 'Enter a price in NIM.'
  } else if (priceLuna === null) {
    // `nimToLuna` rejects on the string, so 250.000001 is caught without
    // tripping over binary rounding (docs/05 §8).
    errors.priceNim = 'NIM supports up to 5 decimal places.'
  } else if (priceLuna <= 0) {
    errors.priceNim = 'Enter a price in NIM.'
  }

  if (draft.expiresOn.trim()) {
    const parsed = Date.parse(`${draft.expiresOn}T23:59:59Z`)
    if (!Number.isFinite(parsed)) errors.expiresOn = 'Enter a valid date.'
    else if (parsed <= now) errors.expiresOn = 'Pick a date in the future.'
  }

  return errors
}
