import '@testing-library/jest-dom/vitest'

import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { resetBackendNetworkCache } from '@/api/runtime'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // The deployment's network/environment answer is cached for the life of a
  // page, which a test file is not: without this, one test's `/public/config`
  // response would satisfy the next test's mock API.
  resetBackendNetworkCache()
  // A fresh browser per test. jsdom keeps one `localStorage` for the whole
  // file, so a test that writes to it — the success dialog remembering which
  // purchases it has already announced, the purchase flow keeping a hash as a
  // recovery hint — would otherwise reach into the next one and make the
  // suite order-dependent.
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // Storage unavailable in this environment; nothing to reset.
  }
})

// jsdom ships neither of these, and the app uses both.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// jsdom defines scrollTo but throws "not implemented"; router scroll
// restoration calls it on every navigation.
window.scrollTo = (() => {}) as typeof window.scrollTo
