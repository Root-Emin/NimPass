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
 * Template holes become `{}` so `/api/v1/catalog/passes/${id}/publish` compares
 * against the spec's `/catalog/passes/{passID}/publish`.
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
    expect(declared).toContain('/public/passes')
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

  it('resolves shared provider links through the contract slug, not a local table', () => {
    // docs/08-ARCHITECTURE.md §80 asks for readable provider URLs. The contract
    // now serves them, so the frontend must use that route rather than keeping
    // a slug→id map of its own, which would go stale the moment a provider is
    // created anywhere else.
    const spec = readFileSync(SPEC, 'utf8')
    expect(spec).toContain('ProviderID: { in: path, name: providerID')
    expect(spec).toContain('/public/providers/by-slug/{slug}')

    const calls = frontendPaths().map((entry) => entry.path)
    expect(calls).toContain('/public/providers/by-slug/{}')
  })

  it('takes the category taxonomy from the backend, member for member', () => {
    // A category the frontend invents is a VALIDATION_ERROR on
    // `/public/passes`, and one the backend adds is a filter nobody ever
    // sees. Both directions are compared, so either drift fails here rather
    // than in the field.
    const spec = readFileSync(SPEC, 'utf8')
    expect(spec).toContain('/public/categories')

    const declared = enumMembers('category', spec.slice(spec.indexOf('  /public/passes:')))
      .filter((value) => value !== "''" && value !== 'null')
      .map((value) => value.replace(/'/g, ''))
    expect(declared.length).toBeGreaterThan(0)

    const source = readFileSync(join(SRC_DIR, 'types', 'domain.ts'), 'utf8')
    const constant = /export const CATEGORIES = \[([\s\S]*?)\] as const/.exec(source)
    const frontend = [...(constant?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]!)

    expect(frontend).toEqual(declared)
  })

  it('reads the filter options from the endpoint rather than shipping a copy', () => {
    // The typed union exists for the compiler. What the *filter* offers has to
    // come from `GET /public/categories`, or a taxonomy change on the backend
    // would need a frontend release to become usable.
    const calls = frontendPaths().map((entry) => entry.path)
    expect(calls).toContain('/public/categories')

    const discover = readFileSync(join(SRC_DIR, 'pages', 'discover.tsx'), 'utf8')
    expect(discover).toContain('useCategories()')
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
      source.indexOf('    Settlement:'),
    )

    // The flags are properties of `Compensation`, not of `Purchase`. Reading
    // them off the purchase root yields `undefined` — falsy — which inverts
    // exactly the guarantee `doNotPayAgain` encodes.
    expect(compensation).toMatch(/doNotPayAgain: \{ type: boolean,/)
    expect(compensation).toContain('automatedRefund: { type: boolean, enum: [false] }')

    // `doNotPayAgain` stopped being a constant when fast settlement gave
    // compensation a second reason (ADR-021). It is true for the original
    // case — real money arrived and a second payment would be lost — and
    // false for a reversed settlement, where no NIM ever left the wallet and
    // the customer may buy again. Pinning it to `enum: [true]` here would
    // mean the contract could never say the second thing.
    expect(compensation).toContain('PASS_EXPIRED_BEFORE_ACTIVATION')
    expect(compensation).toContain('PAYMENT_SETTLEMENT_REVERSED')
    expect(compensation).not.toContain('doNotPayAgain: { type: boolean, enum: [true] }')

    const purchase = source.slice(source.indexOf('    Purchase:'), source.indexOf('    Pass:'))
    expect(purchase).toContain('compensation')
    expect(purchase).not.toMatch(/^\s+doNotPayAgain:/m)
    expect(purchase).not.toMatch(/^\s+automatedRefund:/m)
  })

  it('describes settlement as its own object, separate from purchase status', () => {
    // The two answer different questions — "can the customer have their pass"
    // and "is the payment irreversible yet" — and fast checkout depends on
    // them being allowed to disagree (ADR-021). Flattening settlement onto the
    // purchase root, or teaching the frontend to gate the pass on it, is how
    // the macro-block wait comes back.
    const source = specText()
    const settlement = source.slice(
      source.indexOf('    Settlement:'),
      source.indexOf('    Purchase:'),
    )
    expect(settlement).not.toHaveLength(0)

    // `status` is written in block style here because its description is a
    // paragraph, so the flow-style reader above cannot see it. Its enum is the
    // only one in the schema.
    const statuses = (/enum: \[([^\]]*)\]/.exec(settlement)?.[1] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    expect(new Set(unionMembers('types/domain.ts', 'SettlementStatus'))).toEqual(new Set(statuses))

    // Inclusion is always known; finality is not known until it happens. A
    // spec that made the finality fields required would be unable to express a
    // provisional receipt at all — the defect this mission fixed in the
    // database, repeated in the contract.
    for (const required of ['inclusionBlock', 'includedAt', 'expectedFinalityBlock']) {
      expect(settlement).toContain(required)
    }
    for (const nullable of ['finalityBlock', 'finalizedAt', 'contestedAt']) {
      expect(settlement, `${nullable} must be nullable`).toMatch(
        new RegExp(`${nullable}: \\{[^}]*nullable: true`),
      )
    }

    const purchase = source.slice(source.indexOf('    Purchase:'), source.indexOf('    Pass:'))
    expect(purchase).toContain("$ref: '#/components/schemas/Settlement'")
  })

  it('still declares PASS_PURCHASE_CUTOFF as an error code', () => {
    // The cutoff reaches the frontend only as this code on a 409. If the
    // backend renamed it, the dedicated UI would silently become a generic
    // failure (§8, §39).
    expect(specText()).toContain('PASS_PURCHASE_CUTOFF')
  })

  it('lists passes through the contract endpoint, not through purchases', () => {
    // My Passes used to be assembled from `GET /purchases` plus one read per
    // `passId`, because there was no list endpoint. There is now, and a pass
    // that no purchase in the first hundred produced would be invisible under
    // the old scheme — so the fan-out must stay gone.
    expect(specPaths()).toContain('/passes')

    const calls = frontendPaths().map((entry) => entry.path)
    expect(calls).toContain('/passes')

    const hook = readFileSync(join(SRC_DIR, 'hooks', 'use-passes.ts'), 'utf8')
    expect(hook).toContain('passesApi.listPasses')
    expect(hook, 'the purchase fan-out is back').not.toContain('useMyPurchases')
  })

  it('pages passes with the parameters the spec documents', () => {
    const spec = readFileSync(SPEC, 'utf8')
    const passes = spec.slice(spec.indexOf('  /passes:'), spec.indexOf('  /passes/{passID}:'))
    for (const parameter of ['limit', 'status', 'cursor']) {
      expect(passes, `/passes lost its ${parameter} parameter`).toContain(`name: ${parameter}`)
    }
    expect(spec).toContain('nextCursor')

    const api = readFileSync(join(API_DIR, 'passes.ts'), 'utf8')
    for (const parameter of ['limit', 'status', 'cursor']) {
      expect(api).toContain(parameter)
    }
  })

  it('leaves purchasedPassId nullable, so the pass-provisioning state stays justified', () => {
    // §24: the transitional "confirmed, no pass yet" UI is kept only because
    // the contract still permits that shape. If `purchasedPassId` stops being nullable
    // or `pass_provisioning` disappears, this fails and that UI should go.
    const source = specText()
    const purchase = source.slice(source.indexOf('    Purchase:'), source.indexOf('    Pass:'))
    expect(purchase).toContain('purchasedPassId: { type: string, format: uuid, nullable: true }')
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
  ]

  function schemaFor(name: string, until: string): string {
    const source = specText()
    return source.slice(source.indexOf(`    ${name}:`), source.indexOf(`    ${until}:`))
  }

  it('declares every redemption route the frontend calls', () => {
    const declared = specPaths()
    for (const route of CANONICAL_ROUTES) {
      expect(declared, `spec dropped ${route}`).toContain(route)
    }
  })

  it('has no provider write path into a redemption, on either side', () => {
    // A session is spent by the person who owns the pass. The provider lookup
    // and confirm routes are gone from the contract, and the confirm was where
    // a session used to be consumed — so their absence is the product rule,
    // not a tidy-up. A reappearing path here would restore the old model
    // silently (docs/01-PRODUCT.md §24-§25).
    const declared = specPaths()
    expect(declared).not.toContain('/providers/{providerID}/redemptions/lookup')
    expect(declared).not.toContain('/providers/{providerID}/redemptions/confirm')

    const source = readFileSync(join(API_DIR, 'redemptions.ts'), 'utf8')
    expect(source).not.toContain('/redemptions/lookup')
    expect(source).not.toContain('/redemptions/confirm')
  })

  it('requires a wallet signature for every redemption, with no optional path', () => {
    // `RedemptionAuthorization` requires both fields, and authorization is now
    // the only route that consumes anything. There is no flag anywhere that
    // makes signing skippable — and the frontend must not model one (§10).
    expect(schemaFor('RedemptionAuthorization', 'RedemptionChallenge')).toContain(
      'required: [publicKey, signature]',
    )
    expect(specText()).not.toMatch(/requiresWalletSignature/)

    const domain = readFileSync(join(SRC_DIR, 'types/domain.ts'), 'utf8')
    expect(domain, 'domain.ts still models the signature as optional').not.toMatch(
      /requiresWalletSignature/,
    )
  })

  it('mints no bearer reference anywhere', () => {
    // The NR1 reference existed so a customer could hand something to a
    // provider. With nobody to hand it to, issuing one would be a credential
    // with no purpose and a replay surface with no owner.
    const source = specText()
    expect(source).not.toContain('NR1:')
    expect(source).not.toContain('redemptionReference')
    expect(source).not.toContain('qrExpiresAt')

    for (const file of ['redemptions.ts', '../types/domain.ts', '../types/redemption.ts']) {
      const text = readFileSync(join(API_DIR, file), 'utf8')
      expect(text, `${file} still models a bearer reference`).not.toContain('NR1:')
    }
  })

  it('consumes the session on the authorization response itself', () => {
    // The authorization response is the redemption: it carries the consumed
    // record and the counts the backend wrote in the same transaction, so the
    // frontend never has to compute or poll for them.
    const challenge = schemaFor('RedemptionChallenge', 'RedemptionHistory')
    expect(challenge).toContain('redemption')
    expect(challenge).toContain('pass')
    expect(specText()).toContain('consumes exactly one session in the same transaction')
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
    ]) {
      expect(source, `spec dropped ${code}`).toContain(code)
      expect(errors, `${code} has no human copy`).toContain(code)
    }
  })
})
