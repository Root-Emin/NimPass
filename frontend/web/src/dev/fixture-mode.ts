/**
 * Whether presentation fixtures are serving the public catalogue.
 *
 * Three conditions, all required: not a Vitest run, Vite dev mode, and
 * `VITE_DEV_FIXTURES=1`. Tests mock the API; they must not inherit a
 * developer's fixture flag. The `import.meta.env.DEV` half is a compile-time
 * constant, so every fixture module is dropped from production builds.
 * See ./README.md.
 */
export function fixturesEnabled(): boolean {
  const enabled =
    import.meta.env.MODE !== 'test' &&
    import.meta.env.DEV &&
    import.meta.env.VITE_DEV_FIXTURES === '1'
  if (enabled) announceOnce()
  return enabled
}

/**
 * Development mocks have to be *marked*, not merely isolated
 * (docs/08-ARCHITECTURE.md §14) — otherwise a screenshot of sample content is
 * indistinguishable from a screenshot of a working backend.
 *
 * The marking used to be a banner across the top of the app. It is a console
 * warning now: the product surface stays clean, and anyone inspecting the page
 * still finds the catalogue declared as fixture data. Logged once per session
 * rather than on every request.
 */
let announced = false

function announceOnce(): void {
  if (announced) return
  announced = true
  console.warn(
    '[Nimpass] Development fixtures are ON: the public catalogue is sample data, not backend data. ' +
      'Purchases, passes and redemptions are not simulated. Set VITE_DEV_FIXTURES=0 to turn this off.',
  )
}
