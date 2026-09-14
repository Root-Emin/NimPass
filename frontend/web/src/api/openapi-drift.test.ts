import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every route the frontend calls must exist in `backend/openapi.yaml`.
 *
 * Types catch a renamed field. Nothing catches a renamed *path* — a call to a
 * route the backend does not serve compiles perfectly and fails only at
 * runtime, against a real server, usually in front of someone.
 *
 * So this reads both sides and compares them: the paths declared in the spec,
 * and the paths `src/api/**` actually builds. It is a drift alarm, not a
 * validator — it checks that the routes line up, while `contract.test.ts`
 * checks the payloads.
 */

const SPEC = join(process.cwd(), '..', '..', 'backend', 'openapi.yaml')
const API_DIR = join(process.cwd(), 'src', 'api')
const SRC_DIR = join(process.cwd(), 'src')

function specText(): string {
  return readFileSync(SPEC, 'utf8')
}

/**
 * The members of an inline `enum: [A, B, C]` for a named property.
 *
 * The spec writes its schemas in flow style, so the enum sits on one line —
 * which makes it readable with a regex and keeps this test free of a YAML
 * parser dependency it would otherwise need for four assertions.
 */
function enumMembers(property: string, source = specText()): string[] {
  const match = new RegExp(`${property}: \\{[^}]*?enum: \\[([^\\]]*)\\]`).exec(source)
  if (!match) return []
  return match[1]!.split(',').map((value) => value.trim()).filter(Boolean)
}

/** Union members of an exported TypeScript string-literal union. */
function unionMembers(file: string, typeName: string): string[] {
  const source = readFileSync(join(SRC_DIR, file), 'utf8')
  const declaration = new RegExp(`export type ${typeName} =([\\s\\S]*?)\\n\\n`).exec(source)
  if (!declaration) return []
  return [...declaration[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!)
}

/** Path templates declared under `paths:`, e.g. `/providers/{providerID}`. */
function specPaths(): string[] {
  const spec = readFileSync(SPEC, 'utf8')
  const body = spec.slice(spec.indexOf('\npaths:'), spec.indexOf('\ncomponents:'))
  // Two-space indented keys that start with a slash are the path items.
  return [...body.matchAll(/^ {2}(\/[^\s:]*):/gm)].map((match) => match[1]!)
}

/**
 * Request paths the API modules construct.
 *
 * Template holes become `{}` so `/api/v1/packages/${id}/publish` compares
 * against the spec's `/packages/{packageID}/publish`.
 */
function frontendPaths(): { file: string; path: string }[] {
  const found: { file: string; path: string }[] = []
  for (const file of readdirSync(API_DIR)) {
    if (!file.endsWith('.ts') || file.includes('.test.')) continue
    const source = readFileSync(join(API_DIR, file), 'utf8')
    for (const match of source.matchAll(/['"`](\/api\/v1\/[^'"`]*)['"`]/g)) {
      found.push({ file, path: normalise(match[1]!) })
    }
  }
  return found
}

function normalise(path: string): string {
  return path
    .replace(/^\/api\/v1/, '')
    .replace(/\$\{[^}]*\}/g, '{}')
    .replace(/\/$/, '')
}

/** The spec's own templates, with parameter names flattened the same way. */
function normaliseSpec(path: string): string {
  return path.replace(/\{[^}]*\}/g, '{}')
}

describe('OpenAPI drift', () => {
  const declared = specPaths()

  it('finds the spec and its paths', () => {
    // A silently-empty spec read would make every assertion below vacuous.
    expect(declared.length).toBeGreaterThan(10)
    expect(declared).toContain('/auth/sessions')
    expect(declared).toContain('/public/packages')
  })

  it('calls no route the contract does not declare', () => {
    const known = new Set(declared.map(normaliseSpec))
    const unknown = frontendPaths().filter((entry) => !known.has(entry.path))

    expect(
      unknown,
      `These paths are not in backend/openapi.yaml:\n${unknown
        .map((entry) => `  ${entry.file}: ${entry.path}`)
        .join('\n')}`,
    ).toEqual([])
  })

  it('addresses providers, services and packages by id, as the spec does', () => {
    // The spec's parameters are all `format: uuid`. docs/08-ARCHITECTURE.md §80
    // asks for readable provider slugs instead; the contract has none, so the
    // frontend uses ids and that difference is reported rather than papered
    // over with a client-side slug table.
    const spec = readFileSync(SPEC, 'utf8')
    expect(spec).toContain('ProviderID: { in: path, name: providerID')
    expect(spec).not.toMatch(/name:\s*slug/)
  })

  it('has no client-side category concept, because the contract has none', () => {
    // `Service` and `Package` carry no category in the spec. Filtering by one
    // would be sorting on an attribute the domain does not have.
    const spec = readFileSync(SPEC, 'utf8')
    expect(spec).not.toMatch(/\bcategory\b/i)

    for (const file of readdirSync(API_DIR)) {
      if (!file.endsWith('.ts') || file.includes('.test.')) continue
      // Comments stripped: a note explaining *why* there is no category filter
      // must not read as evidence that there is one.
      const code = readFileSync(join(API_DIR, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code, `${file} still has a category concept`).not.toMatch(/\bcategory\b/)
    }
  })
})

/**
 * Mission 03 contract drift — the purchase and pass half of the API.
 *
 * These schemas describe real money moving, and the frontend's copy of them is
 * a hand-written union in `types/domain.ts`. A status the backend adds and the
 * frontend has never heard of does not fail to compile; it falls through the
 * mapping at runtime, in front of somebody who has just paid.
 *
 * So the enums are compared member by member, in both directions. Adding a
 * status to the spec fails this test until the frontend handles it, and
 * removing one fails until the frontend stops claiming it exists (§42).
 */
describe('Mission 03 purchase contract drift', () => {
  it('exposes the purchase and pass routes the frontend depends on', () => {
    const declared = specPaths()
    for (const route of [
      '/purchases',
      '/purchases/{purchaseID}',
      '/purchases/{purchaseID}/transactions',
      '/purchases/{purchaseID}/reconcile',
      '/purchases/{purchaseID}/cancel',
      '/passes/{passID}',
    ]) {
      expect(declared).toContain(route)
    }
  })

  it('maps every Purchase.status the contract can return', () => {
    const declared = enumMembers('status', specText().slice(specText().indexOf('    Purchase:')))
    expect(declared).toContain('compensation_required')
    expect(new Set(unionMembers('types/domain.ts', 'PurchaseUiStatus'))).toEqual(new Set(declared))
  })

  it('knows every purchaseStatus the record can hold', () => {
    const declared = enumMembers('purchaseStatus')
    expect(declared).toContain('COMPENSATION_REQUIRED')
    expect(new Set(unionMembers('types/domain.ts', 'PurchaseRecordStatus'))).toEqual(
      new Set(declared),
    )
  })

  it('knows every paymentVerification value', () => {
    const declared = enumMembers('paymentVerification')
    expect(declared).toContain('COMPENSATION_REQUIRED')
    expect(new Set(unionMembers('types/domain.ts', 'PaymentVerification'))).toEqual(
      new Set(declared),
    )
  })

  it('keeps the compensation flags nested, where the contract puts them', () => {
    const source = specText()
    const compensation = source.slice(
      source.indexOf('    Compensation:'),
      source.indexOf('    Purchase:'),
    )

    // The flags are properties of `Compensation`, not of `Purchase`. Reading
    // them off the purchase root yields `undefined` — falsy — which inverts
    // exactly the guarantee `doNotPayAgain` encodes.
    expect(compensation).toContain('doNotPayAgain: { type: boolean, enum: [true] }')
    expect(compensation).toContain('automatedRefund: { type: boolean, enum: [false] }')
    expect(compensation).toContain('PACKAGE_EXPIRED_BEFORE_ACTIVATION')

    const purchase = source.slice(source.indexOf('    Purchase:'), source.indexOf('    Pass:'))
    expect(purchase).toContain('compensation')
    expect(purchase).not.toMatch(/^\s+doNotPayAgain:/m)
    expect(purchase).not.toMatch(/^\s+automatedRefund:/m)
  })

  it('still declares PACKAGE_PURCHASE_CUTOFF as an error code', () => {
    // The cutoff reaches the frontend only as this code on a 409. If the
    // backend renamed it, the dedicated UI would silently become a generic
    // failure (§8, §39).
    expect(specText()).toContain('PACKAGE_PURCHASE_CUTOFF')
  })

  it('has no pass list endpoint, which is why My Passes goes through purchases', () => {
    // Documents the gap rather than hiding it. When a list endpoint appears,
    // this fails and `use-passes.ts` should stop fanning out over purchases.
    const declared = specPaths()
    expect(declared).not.toContain('/passes')
    expect(declared).not.toContain('/me/passes')
  })

  it('leaves passId nullable, so the pass-provisioning state stays justified', () => {
    // §24: the transitional "confirmed, no pass yet" UI is kept only because
    // the contract still permits that shape. If `passId` stops being nullable
    // or `pass_provisioning` disappears, this fails and that UI should go.
    const source = specText()
    const purchase = source.slice(source.indexOf('    Purchase:'), source.indexOf('    Pass:'))
    expect(purchase).toContain('passId: { type: string, format: uuid, nullable: true }')
    expect(enumMembers('status', source.slice(source.indexOf('    Purchase:')))).toContain(
      'pass_provisioning',
    )
  })

})

/**
 * Redemption contract lock (Mission 04.1).
 *
 * This block used to assert that redemption did not exist, then that it existed
 * but was unwired. Both are gone: the frontend now calls these routes, so the
 * job here is to pin the exact paths and field names it depends on.
 *
 * Paths are the reason this matters more than types do. A renamed field fails
 * to compile; a renamed *path* compiles perfectly and 404s against a real
 * server — which is precisely what happened once already, when the router and
 * the spec disagreed on `/current` and `/authorization`.
 */
describe('redemption contract lock', () => {
  const CANONICAL_ROUTES = [
    '/passes/{passID}/redemption-challenges',
    '/passes/{passID}/redemption-challenges/current',
    '/passes/{passID}/redemptions',
    '/redemption-challenges/{challengeID}',
    '/redemption-challenges/{challengeID}/authorization',
    '/providers/{providerID}/redemptions',
    '/providers/{providerID}/redemptions/lookup',
    '/providers/{providerID}/redemptions/confirm',
  ]

  function schemaFor(name: string, until: string): string {
    const source = specText()
    return source.slice(source.indexOf(`    ${name}:`), source.indexOf(`    ${until}:`))
  }

  it('declares every redemption route the frontend calls', () => {
    const declared = specPaths()
    for (const route of CANONICAL_ROUTES) expect(declared).toContain(route)
  })

  it('calls the lookup and confirm routes as two separate endpoints', () => {
    // The separation *is* the security property: one reads, one consumes. If
    // they ever collapse into one path, scanning would spend a session (§18).
    const declared = specPaths()
    expect(declared).toContain('/providers/{providerID}/redemptions/lookup')
    expect(declared).toContain('/providers/{providerID}/redemptions/confirm')

    const source = readFileSync(join(API_DIR, 'redemptions.ts'), 'utf8')
    expect(source).toContain('/redemptions/lookup')
    expect(source).toContain('/redemptions/confirm')
  })

  it('requires a wallet signature for every redemption, with no optional path', () => {
    // `RedemptionAuthorization` requires both fields, and authorization is the
    // only route that yields a usable reference. There is no flag anywhere that
    // makes signing skippable — and the frontend must not model one (§10).
    expect(schemaFor('RedemptionAuthorization', 'RedemptionConfirmation')).toContain(
      'required: [publicKey, signature]',
    )
    expect(specText()).not.toMatch(/requiresWalletSignature/)

    const domain = readFileSync(join(SRC_DIR, 'types/domain.ts'), 'utf8')
    expect(domain, 'domain.ts still models the signature as optional').not.toMatch(
      /requiresWalletSignature/,
    )
  })

  it('issues the QR reference only after authorisation, never with the challenge', () => {
    // `redemptionReference` appears on two schemas and means two different
    // things: required on `RedemptionConfirmation` (the provider sends it),
    // nullable on `RedemptionChallenge` (the customer receives it, and only
    // once authorised). Read the challenge's copy specifically.
    const challenge = schemaFor('RedemptionChallenge', 'RedemptionHistory')
    const line = challenge
      .split('\n')
      .find((row) => row.trim().startsWith('redemptionReference:'))

    expect(line).toBeDefined()
    expect(line).toContain('nullable: true')
    expect(line).toContain('Present only in the authorization response')
    expect(line).toContain('NR1:')

    expect(schemaFor('RedemptionConfirmation', 'RedemptionLookup')).toContain(
      'required: [redemptionReference]',
    )
  })

  it('documents rotation as the way to re-issue a reference', () => {
    // The frontend's only recovery path after a reload. If this stops being
    // true, `restoreReference` silently becomes a way to strand customers.
    const source = specText()
    expect(source).toContain('An authorized challenge may rotate its opaque NR1 reference')
    expect(source).toContain('the previous reference is invalidated')
  })

  it('states that reading a challenge back omits the reference', () => {
    expect(specText()).toContain('without returning the bearer QR reference')
  })

  it('states that lookup consumes nothing', () => {
    expect(specText()).toContain('never consumes a session or creates a Redemption')
  })

  it('binds a challenge to one provider', () => {
    expect(schemaFor('RedemptionChallenge', 'RedemptionHistory')).toContain(
      'providerId: { type: string, format: uuid }',
    )
  })

  it('returns the authoritative balance from confirmation', () => {
    expect(schemaFor('RedemptionConfirmationResult', 'Proof')).toContain(
      'required: [redemptionId, passId, redeemedAt, usedSessions, remainingSessions, passStatus, completed]',
    )
  })

  it('keeps the lookup response free of customer identity', () => {
    // Privacy-minimised by contract, and the frontend must not go looking for
    // more than it returns (§19, §20).
    const lookup = schemaFor('RedemptionLookup', 'RedemptionChallenge')
    for (const field of ['ownerWallet', 'customerWallet', 'email', 'identityId']) {
      expect(lookup, `lookup exposes ${field}`).not.toContain(field)
    }
    expect(lookup).toContain('nextSessionOrdinal')
  })

  it('declares the redemption error codes the frontend writes copy for', () => {
    const source = specText()
    const errors = readFileSync(join(API_DIR, 'errors.ts'), 'utf8')
    for (const code of [
      'REDEMPTION_CHALLENGE_EXPIRED',
      'REDEMPTION_ALREADY_CONSUMED',
      'REDEMPTION_NOT_AUTHORIZED',
      'INVALID_REDEMPTION_SIGNATURE',
      'STALE_REDEMPTION_CHALLENGE',
      'INVALID_REDEMPTION_TOKEN',
    ]) {
      expect(source, `spec dropped ${code}`).toContain(code)
      expect(errors, `${code} has no human copy`).toContain(code)
    }
  })

  it('spells the reference the same way on both sides', () => {
    expect(specText()).toContain("pattern: '^NR1:[0-9a-f]{64}$'")
    const source = readFileSync(join(API_DIR, 'redemptions.ts'), 'utf8')
    expect(source).toContain('/^NR1:[0-9a-f]{64}$/')
  })
})
