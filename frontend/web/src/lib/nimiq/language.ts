/**
 * The user's language, as Nimiq Pay reports it.
 *
 * Nimiq Pay seeds `window.nimiqPay.language` with a read-only ISO 639-1 code
 * before the Mini App's page script runs, and docs/04-NIMIQ-MINI-APPS.md §33
 * fixes the order Nimpass must resolve in:
 *
 *   Nimiq Pay language → browser/device language → English
 *
 * Read straight off the host context, which is what the official documentation
 * shows (`window.nimiqPay?.language`). The SDK's `getHostLanguage()` returns the
 * same value; the direct read is used because it needs no module load and is
 * safe before the provider has been initialised — or when there is no provider
 * at all.
 *
 * What this file deliberately is *not*: an i18n layer. Nimpass ships English
 * copy only, so the chain below currently resolves to `en` for everyone. It
 * exists so the host language is honoured the moment a second language is
 * actually translated — adding it to `SUPPORTED_LANGUAGES` is the whole change —
 * and so that `<html lang>` states the truth in the meantime, which is what
 * screen readers and the WebView read it for.
 */

/** Languages Nimpass actually has copy for. Not a wish list. */
export const SUPPORTED_LANGUAGES = ['en'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

/** The Nimiq Pay language, or undefined outside Nimiq Pay (§33). */
export function hostLanguage(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const value = window.nimiqPay?.language
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The device language, as the browser reports it. */
function deviceLanguage(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator.language || undefined
}

/** `de-CH` and `DE` both mean `de`; anything unusable becomes undefined. */
function toLanguageCode(value: string | undefined): string | undefined {
  const code = value?.trim().toLowerCase().split('-')[0]
  return code && code.length > 0 ? code : undefined
}

function isSupported(code: string | undefined): code is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(code as SupportedLanguage)
}

/**
 * Resolves the language to render in, following §33 exactly.
 *
 * An unsupported preference falls through rather than being honoured: showing
 * English to a German speaker is a missing translation, while claiming `de` for
 * English copy would be a lie the browser acts on.
 */
export function resolveLanguage(
  candidates: (string | undefined)[] = [hostLanguage(), deviceLanguage()],
): SupportedLanguage {
  for (const candidate of candidates) {
    const code = toLanguageCode(candidate)
    if (isSupported(code)) return code
  }
  return DEFAULT_LANGUAGE
}

/**
 * Puts the resolved language on `<html lang>`.
 *
 * Returns it too, so a caller can branch on it without resolving twice.
 */
export function applyDocumentLanguage(): SupportedLanguage {
  const language = resolveLanguage()
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language
  }
  return language
}
