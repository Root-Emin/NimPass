import {
  Bike,
  Brain,
  Briefcase,
  Calculator,
  Camera,
  Dumbbell,
  Flower2,
  GraduationCap,
  Guitar,
  HeartPulse,
  Languages,
  Music,
  Palette,
  PersonStanding,
  Piano,
  WavesLadder,
  type LucideIcon,
} from 'lucide-react'

/**
 * A service has no category in the contract. This is not a taxonomy: it is a
 * display hint, inferred from the words the provider already typed, so a guitar
 * lesson can carry a guitar rather than a generic wrench.
 *
 * Matching is conservative. An unknown service stays generic rather than being
 * labelled as something it is not.
 */

export interface ServiceKind {
  id: string
  icon: LucideIcon
  /** Eyebrow flavour for the after-purchase steps, e.g. "more music". */
  stepsMore: string
}

const KINDS: Array<ServiceKind & { terms: string[] }> = [
  { id: 'music', icon: Guitar, stepsMore: 'more music', terms: ['guitar', 'ukulele', 'violin', 'drums', 'drum'] },
  { id: 'music', icon: Piano, stepsMore: 'more music', terms: ['piano', 'keyboard'] },
  { id: 'music', icon: Music, stepsMore: 'more music', terms: ['singing', 'vocal', 'choir', 'music', 'song', 'cello', 'flute', 'sax'] },
  { id: 'fitness', icon: Dumbbell, stepsMore: 'more training', terms: ['training', 'trainer', 'gym', 'strength', 'fitness', 'boxing', 'martial'] },
  { id: 'fitness', icon: Bike, stepsMore: 'more training', terms: ['cycling', 'bike', 'spin'] },
  { id: 'fitness', icon: WavesLadder, stepsMore: 'more training', terms: ['swim'] },
  { id: 'wellness', icon: Flower2, stepsMore: 'more movement', terms: ['yoga'] },
  { id: 'wellness', icon: HeartPulse, stepsMore: 'more movement', terms: ['pilates', 'mobility', 'wellness'] },
  { id: 'wellness', icon: PersonStanding, stepsMore: 'more movement', terms: ['dance', 'ballet'] },
  { id: 'language', icon: Languages, stepsMore: 'more fluency', terms: ['language', 'english', 'german', 'spanish', 'french', 'italian', 'turkish', 'conversation'] },
  { id: 'tutoring', icon: Calculator, stepsMore: 'more learning', terms: ['math', 'maths', 'algebra', 'calculus'] },
  { id: 'tutoring', icon: GraduationCap, stepsMore: 'more learning', terms: ['tutor', 'exam', 'homework'] },
  { id: 'art', icon: Camera, stepsMore: 'more seeing', terms: ['photo'] },
  { id: 'art', icon: Palette, stepsMore: 'more making', terms: ['art', 'paint', 'draw', 'illustration'] },
  { id: 'coaching', icon: Brain, stepsMore: 'more clarity', terms: ['coach', 'career', 'mentor'] },
]

const FALLBACK: ServiceKind = {
  id: 'service',
  icon: Briefcase,
  stepsMore: 'more sessions',
}

export function serviceKind(name: string): ServiceKind {
  const haystack = name.trim().toLowerCase()
  if (!haystack) return FALLBACK
  const match = KINDS.find((kind) => kind.terms.some((term) => haystack.includes(term)))
  if (!match) return FALLBACK
  return { id: match.id, icon: match.icon, stepsMore: match.stepsMore }
}

/** Curated tiles on the home grid — a search, not a filter. */
export const SERVICE_KIND_TILES: Array<{ label: string; icon: LucideIcon }> = [
  { label: 'Personal training', icon: Dumbbell },
  { label: 'Guitar lessons', icon: Guitar },
  { label: 'Language tutoring', icon: Languages },
  { label: 'Yoga', icon: Flower2 },
  { label: 'Swimming', icon: WavesLadder },
  { label: 'Career coaching', icon: Brain },
  { label: 'Maths tutoring', icon: Calculator },
  { label: 'Pilates', icon: HeartPulse },
  { label: 'Cycling', icon: Bike },
  { label: 'Art classes', icon: Palette },
  { label: 'Photography', icon: Camera },
  { label: 'Exam prep', icon: GraduationCap },
]
