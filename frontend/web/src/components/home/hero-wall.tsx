import { SessionDots } from '@/components/pass/session-dots'
import type { PassListing } from '@/types/domain'

/**
 * The scattered wall behind the landing hero.
 *
 * The composition is borrowed from Luma's landing page — objects from the
 * product strewn around a centred statement, some clipped by the edges of the
 * viewport (docs/03-DESIGN-SYSTEM.md §110 names Home as the page where Luma's
 * influence should be strongest). What is strewn about is ours: miniature
 * passes, each a service still-life with the remaining-session count on it.
 *
 * Photographs are atmospheric still-lifes of the *service type*, not portraits
 * of a provider the contract does not give us an image for
 * (docs/08-ARCHITECTURE.md §11).
 *
 * Two rules shape the implementation.
 *
 * It is **entirely decorative**: `aria-hidden`, no links, no pointer events.
 * Ten more links before the `h1` would bury the page's actual first action, and
 * a focusable control inside an aria-hidden subtree is a keyboard trap — the
 * same trap the mobile purchase bar avoids with `inert`. The real, clickable
 * catalogue is the Featured section further down the page.
 *
 * And it prefers **real published passes**, falling back to generic examples
 * only for slots the catalogue cannot fill. A real tile shows a real service
 * and a real session count; an example tile carries a service *type* and a
 * session count and nothing else — no provider, no price, nothing that could be
 * read as an offer (docs/08-ARCHITECTURE.md §11).
 */
interface Slot {
  left: string
  top: string
  /** Rendered width in px. Variety is what stops the wall reading as a grid. */
  width: number
  rotate: number
}

/**
 * Positions are hand-placed, not generated.
 *
 * Two constraints decide them. The centre column stays clear — a tile behind
 * the headline or under the primary action is a collision, not scatter. And
 * the tiles that leave the frame leave it *sideways*: the hero has a section
 * directly beneath it, so a tile clipped by the bottom edge reads as a stray
 * shape crowding the next heading rather than as depth.
 */
const SLOTS: Slot[] = [
  // Left cluster, outermost tiles clipped by the viewport edge.
  { left: '-2%', top: '10%', width: 124, rotate: 6 },
  { left: '8%', top: '22%', width: 142, rotate: -5 },
  { left: '20%', top: '6%', width: 110, rotate: -4 },
  { left: '-5%', top: '42%', width: 118, rotate: -6 },
  { left: '11%', top: '52%', width: 158, rotate: 3 },
  { left: '3%', top: '72%', width: 128, rotate: 5 },
  { left: '18%', top: '82%', width: 132, rotate: -3 },
  { left: '-1%', top: '88%', width: 112, rotate: 4 },
  { left: '24%', top: '94%', width: 108, rotate: 2 },
  // Right cluster.
  { left: '80%', top: '6%', width: 112, rotate: 5 },
  { left: '88%', top: '20%', width: 146, rotate: 4 },
  { left: '100%', top: '12%', width: 116, rotate: -5 },
  { left: '96%', top: '38%', width: 114, rotate: 3 },
  { left: '91%', top: '54%', width: 154, rotate: -3 },
  { left: '103%', top: '52%', width: 108, rotate: -6 },
  { left: '79%', top: '78%', width: 134, rotate: 3 },
  { left: '93%', top: '84%', width: 126, rotate: -4 },
  { left: '70%', top: '92%', width: 116, rotate: 2 },
]

/**
 * Still-lifes keyed to a service *kind*, not a person.
 *
 * First matching rule wins, so specific instruments sit above the broader
 * buckets. Every tile gets a photograph — unmatched names fall through to a
 * generic tutoring still-life rather than a blank colour field.
 */
const COVER_RULES: { match: RegExp; file: string }[] = [
  { match: /guitar|ukulele/, file: 'guitar' },
  { match: /sing|vocal|choir/, file: 'singing' },
  { match: /piano/, file: 'piano' },
  { match: /box|mma|kickbox/, file: 'boxing' },
  { match: /yoga|meditation/, file: 'yoga' },
  { match: /pilates/, file: 'pilates' },
  { match: /swim|aqua/, file: 'swimming' },
  { match: /cycl|bike/, file: 'cycling' },
  { match: /photo/, file: 'photo' },
  { match: /art|paint|draw|illustrat/, file: 'art' },
  { match: /math/, file: 'maths' },
  { match: /spanish|german|french|english|language|conversation/, file: 'language' },
  { match: /train|fitness|gym|strength|mobility/, file: 'training' },
  { match: /coach|mentor|consult|career|nutrition/, file: 'coaching' },
  { match: /tutor|exam/, file: 'tutoring' },
  { match: /music/, file: 'piano' },
]

const FALLBACK_COVER = '/hero/tutoring.jpg'

function coverFor(service: string): string {
  const key = service.toLowerCase()
  const rule = COVER_RULES.find((entry) => entry.match.test(key))
  return rule ? `/hero/${rule.file}.jpg` : FALLBACK_COVER
}

/**
 * Stand-ins for slots the live catalogue cannot fill.
 *
 * Service types rather than services anyone is selling, with no provider, no
 * price and no call to action — an illustration of what a pass is for, not a
 * shop window with invented stock.
 */
const EXAMPLES = [
  { service: 'Personal training', sessions: 10 },
  { service: 'Guitar lessons', sessions: 8 },
  { service: 'Spanish tutoring', sessions: 12 },
  { service: 'Yoga', sessions: 6 },
  { service: 'Swimming', sessions: 10 },
  { service: 'Career coaching', sessions: 5 },
  { service: 'Pilates', sessions: 8 },
  { service: 'Maths tutoring', sessions: 12 },
  { service: 'Boxing', sessions: 10 },
  { service: 'Piano lessons', sessions: 6 },
  { service: 'Cycling', sessions: 8 },
  { service: 'Art classes', sessions: 10 },
  { service: 'Photography', sessions: 6 },
  { service: 'German conversation', sessions: 9 },
  { service: 'Singing lessons', sessions: 6 },
  { service: 'Exam prep', sessions: 12 },
  { service: 'Nutrition coaching', sessions: 4 },
  { service: 'Strength training', sessions: 10 },
] as const

interface Tile {
  seed: string
  service: string
  sessions: number
  /** Real passes carry a title; examples do not. */
  real: boolean
}

function buildTiles(passes: PassListing[] | undefined): Tile[] {
  const real: Tile[] = (passes ?? []).slice(0, SLOTS.length).map((item) => ({
    seed: item.provider.name,
    service: item.service.name,
    sessions: item.sessions,
    real: true,
  }))

  const filled = [...real]
  for (const example of EXAMPLES) {
    if (filled.length >= SLOTS.length) break
    filled.push({ seed: example.service, service: example.service, sessions: example.sessions, real: false })
  }
  return filled
}

function punch(tile: Tile) {
  const used = Math.min(tile.sessions - 1, Math.max(1, (tile.seed.length % 3) + 1))
  return { used, remaining: tile.sessions - used }
}

export function HeroWall({ passes }: { passes: PassListing[] | undefined }) {
  const tiles = buildTiles(passes)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden select-none lg:block"
    >
      {SLOTS.map((slot, index) => {
        const tile = tiles[index]
        if (!tile) return null

        return (
          <div
            key={`${slot.left}-${slot.top}`}
            className="absolute"
            style={{
              left: slot.left,
              top: slot.top,
              width: slot.width,
              transform: `translate(-50%, -50%) rotate(${slot.rotate}deg)`,
            }}
          >
            <PassCover tile={tile} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * The wall's mobile counterpart.
 *
 * Below `lg` the scatter has nowhere to scatter to, so the same objects line up
 * in a single row that runs off both edges — the composition changes, the
 * content does not (docs/03-DESIGN-SYSTEM.md §7, §9). Decorative on the same
 * terms as the wall.
 */
export function HeroStrip({ passes }: { passes: PassListing[] | undefined }) {
  const tiles = buildTiles(passes).slice(0, 7)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative -mx-5 mt-12 select-none overflow-hidden sm:mt-14 lg:hidden"
      style={{
        maskImage: 'linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent)',
      }}
    >
      <div className="flex justify-center gap-3 px-5">
        {tiles.map((tile, index) => (
          <div
            key={`${tile.service}-${index}`}
            className="w-28 shrink-0"
            style={{ transform: `rotate(${index % 2 === 0 ? -3 : 3}deg)` }}
          >
            <PassCover tile={tile} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * A pass in miniature, sitting on a photograph of the service.
 *
 * Every tile on the wall is this object: remaining sessions, the word "left",
 * and the punch-card dots. The photograph stays in the middle of the card;
 * the caption lives in a top and bottom fade so the type is not painted over
 * by the image.
 */
function PassCover({ tile }: { tile: Tile }) {
  const cover = coverFor(tile.service)
  const { used, remaining } = punch(tile)
  const showDots = tile.sessions <= 10

  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl shadow-lift ring-1 ring-ink/10">
      <img src={cover} alt="" className="absolute inset-0 size-full object-cover" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgb(12 16 14 / 0.62) 0%, rgb(12 16 14 / 0.1) 32%, rgb(12 16 14 / 0.42) 58%, rgb(12 16 14 / 0.9) 100%)',
        }}
      />
      <div className="relative flex h-full flex-col justify-between p-3">
        <span className="eyebrow line-clamp-2 text-white drop-shadow-[0_1px_8px_rgb(0_0_0_/_0.55)]">
          {tile.service}
        </span>
        <div>
          <p className="flex items-baseline gap-1.5 drop-shadow-[0_1px_8px_rgb(0_0_0_/_0.55)]">
            <span className="numeric font-display text-[1.75rem] font-semibold leading-none text-white">
              {remaining}
            </span>
            <span className="text-micro text-white/85">left</span>
          </p>
          {showDots ? (
            <SessionDots used={used} total={tile.sessions} tone="inverse" className="mt-2" />
          ) : null}
        </div>
      </div>
    </div>
  )
}
