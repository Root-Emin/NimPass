import { civilToIso, DEFAULT_EXPIRY_TIME } from '@/lib/civil-date'
import type { PassDraft } from '@/pages/provider/pass-form'

/**
 * Validates a pass draft.
 *
 * Lives outside the component and reads the clock itself, with `now` injectable
 * so the expiry rule can be exercised against a fixed instant. Keeping the
 * impure read out of the component body also keeps the render path honestly
 * pure.
 *
 * This is a convenience for the provider, not a security boundary — the backend
 * validates and stores the truth (docs/09-SECURITY.md §75).
 */
export function validatePassDraft(
  draft: PassDraft,
  context: {
    sessionCount: number
    priceLuna: number | null
    now?: number
    /**
     * True on a wallet's first Pass, when the provider record it will belong to
     * does not exist yet and the form is collecting the name to create it with
     * (docs/DECISIONS.md ADR-020). False for every provider who already has one
     * — the field is not on screen, so an empty value must not block the save.
     */
    needsStoreName?: boolean
  },
): Partial<Record<keyof PassDraft, string>> {
  const { sessionCount, priceLuna, now = Date.now(), needsStoreName = false } = context
  const errors: Partial<Record<keyof PassDraft, string>> = {}

  // The pass's name drives everything downstream: the service a pass belongs to
  // is resolved from it when the pass is saved, so a name that is missing
  // blocks the whole write.
  if (!draft.title.trim()) errors.title = 'Give the pass a name.'

  // `ProviderInput.name` is required and the column rejects blank
  // (`providers_name_nonempty`), so an empty store name cannot create the
  // record the pass needs.
  if (needsStoreName && !draft.storeName.trim()) {
    errors.storeName = 'Tell customers who they are buying from.'
  }

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
    const iso = civilToIso(draft.expiresOn, draft.expiresAtTime || DEFAULT_EXPIRY_TIME)
    const parsed = iso ? Date.parse(iso) : Number.NaN
    if (!Number.isFinite(parsed)) errors.expiresOn = 'Enter a valid date.'
    else if (parsed <= now) errors.expiresOn = 'Pick a date and time in the future.'
  }

  return errors
}
