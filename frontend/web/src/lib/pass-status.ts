import type { BadgeProps } from '@/components/ui/badge'
import type { PassStatus } from '@/types/domain'

/**
 * How each `domain.PassStatus` is named and toned.
 *
 * Centralised because two screens read it — My Store and the Profile preview —
 * and a pass that reads one way in one place and another way in the other is
 * exactly the drift §97 keeps tokens in one file to prevent. Status is never
 * colour alone: every entry carries a word (§19, §78).
 *
 * `DRAFT` is worded as what it means to the person who made it rather than as
 * the enum's own name: a pass nobody can buy yet is "Not published", and the
 * product no longer speaks about drafts anywhere a provider can see.
 *
 * `UNAVAILABLE` is "Unpublished" for the same reason, and the pairing with
 * "Published" is the point: the two are one reversible switch a provider throws
 * (`02-USER-FLOWS.md` §80, `03-DESIGN-SYSTEM.md` "active, unpublished"). It is
 * toned `neutral` rather than `warning` because nothing is wrong — a pass off
 * the shelf is a decision, not a problem — while `DRAFT` stays distinct from it:
 * never published and withdrawn are different facts about a pass.
 */
export const PASS_STATUS: Record<PassStatus, { label: string; tone: BadgeProps['tone'] }> = {
  DRAFT: { label: 'Not published', tone: 'neutral' },
  ACTIVE: { label: 'Published', tone: 'success' },
  UNAVAILABLE: { label: 'Unpublished', tone: 'neutral' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
}
