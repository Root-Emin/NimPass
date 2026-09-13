/**
 * Whether presentation fixtures are serving the public catalogue.
 *
 * Two conditions, both required: the app must be running in Vite dev mode, and
 * `VITE_DEV_FIXTURES=1` must be set. The `import.meta.env.DEV` half is a
 * compile-time constant, so every fixture module is dropped from production
 * builds. See ./README.md.
 */
export function fixturesEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_DEV_FIXTURES === '1'
}
