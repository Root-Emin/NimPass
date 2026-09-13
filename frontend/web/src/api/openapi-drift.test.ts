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
