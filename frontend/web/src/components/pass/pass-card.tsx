import { Link } from 'react-router-dom'

import { PassStatusBadge } from '@/components/pass/pass-status-badge'
import { SessionProgress } from '@/components/pass/session-progress'
import { Card } from '@/components/ui/card'
import type { Pass } from '@/types/domain'

export function PassCard({ pass }: { pass: Pass }) {
  return (
    <Card className="transition-shadow duration-[--nimpass-duration-base] hover:shadow-lift">
      <Link to={`/passes/${pass.id}`} className="block space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            {/* The contract's Pass carries the package title it was sold under
                and no service or provider name, so the card leads with that
                rather than labelling it with something it does not know. */}
            <h3 className="truncate text-h3 text-ink">{pass.packageTitle}</h3>
          </div>
          <PassStatusBadge status={pass.status} />
        </div>

        <SessionProgress pass={pass} />
      </Link>
    </Card>
  )
}
