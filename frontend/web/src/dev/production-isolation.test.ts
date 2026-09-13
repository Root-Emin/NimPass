import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Development fixtures must not reach a production build.
 *
 * `src/dev/**` exists so the public catalogue can be designed before the
 * backend serves it. That is only safe while it is impossible to ship: a demo
 * that quietly renders invented providers would be exactly the "fake data in
 * the judged build" the competition rules reject (docs/05 §106,
 * docs/09-SECURITY.md §102-§103, docs/08-ARCHITECTURE.md §14).
 *
 * The guard is structural — `import.meta.env.DEV` is a compile-time constant,
 * so the branch and everything behind it are eliminated — but "we believe it
 * tree-shakes" is not a security property. This checks the artefact.
 *
 * It reads `dist/` rather than building, so it is fast and runs in the normal
 * suite; `npm run build` is the step that produces the input.
 */

const DIST = join(process.cwd(), 'dist')

/** Strings that could only come from the fixture modules. */
const FIXTURE_MARKERS = [
  // Module and API surface.
  'serveFromFixtures',
  'FIXTURE_PACKAGES',
  'FIXTURE_PROVIDERS',
  'FIXTURE_SERVICES',
  'fixturesEnabled',
  'VITE_DEV_FIXTURES',
  // The banner that announces fixture mode.
  'Development fixtures',
  'not backend data',
  // Invented identities from src/dev/fixtures/catalogue.ts.
  'prov_alex',
  'Mira Bendz',
  'Kadıköy',
]

function bundleFiles(): string[] {
  const assets = join(DIST, 'assets')
  if (!existsSync(assets)) return []
  return readdirSync(assets)
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .map((name) => join(assets, name))
}

describe('production build isolation', () => {
  const files = bundleFiles()

  it('has a build to inspect', () => {
    // A green suite must not be able to mean "we never looked".
    expect(
      files.length,
      'No production bundle found. Run `npm run build` before `npm test` to verify fixture isolation.',
    ).toBeGreaterThan(0)
  })

  it.each(FIXTURE_MARKERS)('does not ship the fixture marker %s', (marker) => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(marker))
    expect(offenders, `"${marker}" reached the production bundle`).toEqual([])
  })

  it('ships no development-only module chunk', () => {
    const chunks = files.map((file) => file.toLowerCase())
    expect(chunks.filter((name) => /fixture|catalogue/.test(name))).toEqual([])
  })

  it('contains no hardcoded wallet-shaped secrets or seed phrases', () => {
    // docs/09-SECURITY.md §27, §102: nothing key-like belongs in a bundle the
    // user can read.
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, `${file} mentions a seed phrase`).not.toMatch(/seed\s*phrase\s*[:=]/i)
      expect(source, `${file} embeds a private key`).not.toMatch(/privateKey\s*[:=]\s*["'][0-9a-f]{32,}/i)
    }
  })
})
