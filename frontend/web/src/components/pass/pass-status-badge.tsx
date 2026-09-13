import { CheckCircle2, CircleSlash, Clock, Ticket } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge, type BadgeProps } from '@/components/ui/badge'
import type { PassStatus } from '@/types/domain'

/**
 * Status always reads as icon + word, never colour alone (§19, §79).
 *
 * There is no "pending" pass: `domain.NewPass` refuses anything but a confirmed,
 * verified purchase, so a pass only ever exists in one of these four states.
 */
const STATUS: Record<PassStatus, { label: string; tone: BadgeProps['tone']; icon: ReactNode }> = {
  ACTIVE: { label: 'Active', tone: 'accent', icon: <Ticket /> },
  COMPLETED: { label: 'Completed', tone: 'success', icon: <CheckCircle2 /> },
  EXPIRED: { label: 'Expired', tone: 'warning', icon: <Clock /> },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: <CircleSlash /> },
}

export function PassStatusBadge({ status }: { status: PassStatus }) {
  const config = STATUS[status]
  return (
    <Badge tone={config.tone}>
      {config.icon}
      {config.label}
    </Badge>
  )
}
