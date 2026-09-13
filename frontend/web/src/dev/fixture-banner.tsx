import { FlaskConical } from 'lucide-react'

import { fixturesEnabled } from '@/dev/fixture-mode'

/**
 * Says out loud that the catalogue on screen is presentation fixture data, so
 * nobody reviewing Nimpass mistakes it for a working backend.
 * Renders nothing in production. See ./README.md.
 */
export function FixtureBanner() {
  if (!fixturesEnabled()) return null

  return (
    <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-center text-micro text-warning">
      <FlaskConical className="size-3 shrink-0" aria-hidden="true" />
      <span>
        Development fixtures — catalogue content is sample data, not backend data. Purchases,
        passes and redemptions are not simulated.
      </span>
    </div>
  )
}
