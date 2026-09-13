import type { Package, PublicOffer, PublicProvider, PublicService } from '@/types/domain'

/**
 * Presentation fixtures for the public catalogue. See ../README.md.
 *
 * Shaped as `PublicOffer`, exactly as `GET /public/packages` returns it, so a
 * screen that renders these renders the real contract. They describe plausible
 * providers so layout, hierarchy and density can be judged; they are not
 * backend data and never stand in for business truth.
 */

function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString()
}

const PROVIDERS: PublicProvider[] = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Alex Fitness' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Mira Bendz' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Kaan Studio' },
]

const SERVICES: PublicService[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Personal Training',
    description: 'One-to-one strength sessions, planned around what you can commit to.',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'German Conversation',
    description: 'Spoken practice for people who can read German but freeze when speaking.',
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    name: 'Guitar Lessons',
    description: 'Beginner and returning players, acoustic or electric.',
  },
]

function pkg(index: number, overrides: Partial<Package>): Package {
  return {
    id: `30000000-0000-4000-8000-00000000000${index}`,
    providerId: PROVIDERS[index - 1]!.id,
    serviceId: SERVICES[index - 1]!.id,
    title: 'Package',
    description: '',
    sessions: 10,
    priceLuna: 25_000_000,
    currency: 'NIM',
    expirationAt: null,
    status: 'ACTIVE',
    createdAt: iso(-30),
    updatedAt: iso(-30),
    ...overrides,
  }
}

export const FIXTURE_OFFERS: PublicOffer[] = [
  {
    package: pkg(1, {
      title: '10 Personal Training Sessions',
      description: 'Ten private sessions, 60 minutes each, at the studio or online.',
      sessions: 10,
      priceLuna: 25_000_000,
    }),
    provider: PROVIDERS[0]!,
    service: SERVICES[0]!,
  },
  {
    package: pkg(2, {
      title: '12 German Conversation Hours',
      description: 'Twelve hours of spoken practice, scheduled as it suits you.',
      sessions: 12,
      priceLuna: 30_000_000,
      expirationAt: iso(180),
    }),
    provider: PROVIDERS[1]!,
    service: SERVICES[1]!,
  },
  {
    package: pkg(3, {
      title: '5 Guitar Lessons',
      description: 'Five lessons for beginners and returning players.',
      sessions: 5,
      priceLuna: 14_000_000,
    }),
    provider: PROVIDERS[2]!,
    service: SERVICES[2]!,
  },
]
