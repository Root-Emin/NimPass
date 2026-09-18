import { GraduationCap, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { markTone } from '@/lib/mark-tone'
import { SERVICE_KIND_TILES, serviceKind } from '@/lib/service-kind'
import type { PassListing } from '@/types/domain'

/**
 * Ways into the catalogue, by the kind of service people sell.
 *
 * Structurally this is Luma's category grid; the content is not, because
 * Nimpass has no categories. `category` is not a field in the contract — the
 * frontend used to invent one and that was removed — so a tile here is a
 * *search*, not a taxonomy: it drops the visitor into Discover with a term
 * prefilled, and Discover answers honestly when nothing matches
 * (docs/08-ARCHITECTURE.md §11, docs/03-DESIGN-SYSTEM.md §40-§41).
 *
 * Service types that genuinely exist in the published catalogue are hoisted to
 * the front, so the grid leads with what can actually be bought today and then
 * shows the shape of everything else Nimpass is for.
 */
interface ServiceTile {
  label: string
  icon: LucideIcon
}

/** Published service names, de-duplicated, in catalogue order. */
function liveServices(passes: PassListing[] | undefined): ServiceTile[] {
  const seen = new Set<string>()
  const live: ServiceTile[] = []

  for (const item of passes ?? []) {
    const label = item.service.name.trim()
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    const known = SERVICE_KIND_TILES.find((kind) => kind.label.toLowerCase() === key)
    live.push({ label, icon: known?.icon ?? serviceKind(label).icon ?? GraduationCap })
  }

  return live
}

export function ServiceTiles({ passes }: { passes: PassListing[] | undefined }) {
  const live = liveServices(passes)
  const liveKeys = new Set(live.map((kind) => kind.label.toLowerCase()))
  const rest = SERVICE_KIND_TILES.filter((kind) => !liveKeys.has(kind.label.toLowerCase()))
  const tiles = [...live, ...rest].slice(0, 12)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map((tile) => {
        const tone = markTone(tile.label)
        return (
          <Link
            key={tile.label}
            to={`/discover?q=${encodeURIComponent(tile.label)}`}
            className="group flex flex-col justify-between gap-6 rounded-xl border border-line bg-surface p-4 transition-[border-color,box-shadow] duration-[--nimpass-duration-base] hover:border-line-strong hover:shadow-lift sm:p-5"
          >
            <span
              className="flex size-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${tone.from}16`, color: tone.from }}
            >
              <tile.icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="text-body font-medium text-ink">{tile.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
