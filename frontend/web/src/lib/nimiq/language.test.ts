import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_LANGUAGE,
  applyDocumentLanguage,
  hostLanguage,
  resolveLanguage,
} from './language'

/**
 * The resolution order is fixed by docs/04-NIMIQ-MINI-APPS.md §33:
 * Nimiq Pay language → browser/device language → English.
 */

function setHostLanguage(language: string | undefined): void {
  if (language === undefined) {
    Reflect.deleteProperty(window, 'nimiqPay')
    return
  }
  Object.defineProperty(window, 'nimiqPay', {
    value: { language, requestDeviceIdentifier: async () => '' },
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  setHostLanguage(undefined)
  document.documentElement.removeAttribute('lang')
})

describe('host language', () => {
  it('reads the language Nimiq Pay injected', () => {
    setHostLanguage('de')
    expect(hostLanguage()).toBe('de')
  })

  it('is undefined outside Nimiq Pay, where the host context does not exist', () => {
    expect(hostLanguage()).toBeUndefined()
  })

  it('ignores an empty language rather than treating it as a preference', () => {
    setHostLanguage('')
    expect(hostLanguage()).toBeUndefined()
  })
})

describe('resolveLanguage', () => {
  it('prefers the Nimiq Pay language over the device language', () => {
    // Both supported, so precedence is what is actually being asserted.
    expect(resolveLanguage(['en', 'de'])).toBe('en')
  })

  it('normalises a regional code to its language', () => {
    expect(resolveLanguage(['EN-GB'])).toBe('en')
  })

  it('falls through an unsupported preference instead of honouring it', () => {
    // Nimpass ships English copy only: claiming `de` would be a lie the
    // browser and assistive technology would act on.
    expect(resolveLanguage(['de', 'fr'])).toBe(DEFAULT_LANGUAGE)
  })

  it('falls back to English when nothing is offered', () => {
    expect(resolveLanguage([undefined, undefined])).toBe(DEFAULT_LANGUAGE)
  })
})

describe('applyDocumentLanguage', () => {
  it('states the resolved language on the document', () => {
    setHostLanguage('en')
    expect(applyDocumentLanguage()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
})
