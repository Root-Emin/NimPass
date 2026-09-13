import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { globSync } from 'node:fs'

/**
 * Architectural boundaries, enforced against the source itself.
 *
 * These are the rules that erode quietly. No single commit decides to make the
 * frontend authoritative over money or sessions — it happens one convenient
 * shortcut at a time, and a review three milestones later cannot see it. So the
 * boundaries are asserted rather than trusted:
 *
 *  - the frontend is never authoritative for economic state
 *    (docs/08-ARCHITECTURE.md §11, docs/09-SECURITY.md §6)
 *  - all Nimiq access goes through one adapter (§16-§17, §85)
 *  - all backend access goes through one API client (§77)
 */

const SRC = join(process.cwd(), 'src')

function sourceFiles(pattern: string): string[] {
  return globSync(pattern, { cwd: SRC })
    .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
    .map((file) => join(SRC, file))
}

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/**
 * Source with comments removed.
 *
 * These assertions are about what the code *does*. A comment explaining why
 * Nimpass deliberately has no `mark-success` endpoint must not read as evidence
 * that it has one.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Every non-test source file. */
const ALL = sourceFiles('**/*.{ts,tsx}')

describe('the frontend is not the authority', () => {
  it('never adjusts a session balance locally', () => {
    // `remainingSessions -= 1` in a component is the exact pattern
    // docs/08-ARCHITECTURE.md §49 forbids. The decrement is one atomic backend
    // transaction and the client only ever reads the result back.
    const offenders = ALL.filter((file) =>
      /sessionsRemaining\s*(-=|\+=|--|\+\+)/.test(code(file)),
    )
    expect(offenders).toEqual([])
  })

  it('never writes session counts, pass status or purchase status into a request body', () => {
    // Server-generated fields the client may not set (docs/08 §147,
    // docs/09-SECURITY.md §39-§41).
    const forbidden = /body:\s*{[^}]*\b(sessionsRemaining|sessionsUsed|sessionsTotal|passStatus)\b/s
    const offenders = ALL.filter((file) => forbidden.test(code(file)))
    expect(offenders).toEqual([])
  })

  it('never sends a price or recipient when creating a purchase', () => {
    // The client sends a package id. Price, recipient, amount and reference all
    // come back from the backend (docs/05 §13-§14, docs/08 §71).
    const purchases = read(join(SRC, 'api/purchases.ts'))
    const createIntent = purchases.slice(
      purchases.indexOf('export function createPurchaseIntent'),
      purchases.indexOf('export function reportTransactionSubmission'),
    )
    for (const field of ['priceLuna', 'amountLuna', 'recipientAddress', 'paymentReference']) {
      expect(createIntent, `createPurchaseIntent must not send ${field}`).not.toContain(field)
    }
  })

  it('has no endpoint that asserts a payment succeeded', () => {
    // docs/08-ARCHITECTURE.md §63: no `mark-success`. Reconciliation *requests*
    // a re-check; it does not claim an outcome.
    const api = sourceFiles('api/**/*.ts').map(code).join('\n')
    expect(api).not.toMatch(/mark-success|paymentSuccessful|confirm-payment/i)
  })
})

describe('integration boundaries hold', () => {
  it('reaches the Nimiq SDK only through the adapter', () => {
    const offenders = ALL.filter(
      (file) =>
        !file.includes(join('lib', 'nimiq')) && code(file).includes('@nimiq/mini-app-sdk'),
    )
    expect(offenders).toEqual([])
  })

  it('touches window.nimiq only inside the adapter', () => {
    const offenders = ALL.filter(
      (file) => !file.includes(join('lib', 'nimiq')) && /window\.nimiq\b/.test(code(file)),
    )
    expect(offenders).toEqual([])
  })

  it('calls fetch only from the API client', () => {
    // docs/08-ARCHITECTURE.md §77: components do not contain duplicated raw
    // fetch logic.
    const offenders = ALL.filter(
      (file) => !file.endsWith(join('api', 'client.ts')) && /(?<![.\w])fetch\s*\(/.test(code(file)),
    )
    expect(offenders).toEqual([])
  })

  it('keeps authentication out of browser storage', () => {
    // The session is an httpOnly cookie; nothing auth-shaped belongs in
    // storage a script can read (docs/09-SECURITY.md §62).
    const offenders = ALL.filter((file) => /localStorage|sessionStorage/.test(code(file)))
    expect(offenders).toEqual([])
  })

  it('converts NIM and Luna in exactly one module', () => {
    // docs/05-NIMIQ-PAY-INTEGRATION.md §9: one canonical conversion, not a
    // formula per screen.
    const offenders = ALL.filter(
      (file) => !file.endsWith(join('lib', 'format.ts')) && /LUNA_PER_NIM/.test(code(file)),
    )
    expect(offenders).toEqual([])
  })
})
