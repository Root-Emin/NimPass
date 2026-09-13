import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { Pass } from '@/types/domain'

/**
 * The remaining session count is the single most important number on a pass
 * (docs/03-DESIGN-SYSTEM.md §51-§52). Every value here is rendered straight
 * from the backend — nothing is decremented client-side.
 */
export function SessionProgress({ pass, className }: { pass: Pass; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-small text-ink-muted">
          <span className="font-display text-h2 font-semibold text-ink">
            {pass.remainingSessions}
          </span>{' '}
          of {pass.originalSessions} sessions left
        </p>
        <p className="text-micro text-ink-subtle">{pass.usedSessions} used</p>
      </div>
      <Progress
        value={pass.usedSessions}
        max={pass.originalSessions}
        label={`${pass.usedSessions} of ${pass.originalSessions} sessions used`}
      />
    </div>
  )
}
