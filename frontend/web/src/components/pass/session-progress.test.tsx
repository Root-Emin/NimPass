import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SessionBalance } from '@/components/pass/session-progress'
import { aPurchasedPass } from '@/test/fixtures'

/**
 * What a Pass may claim about itself once it can no longer be used.
 *
 * The backend deliberately leaves the session counters truthful when a
 * settlement is reversed (ADR-024): `used_sessions` keeps naming what the
 * provider actually delivered and `remaining_sessions` what was sold and never
 * delivered, while the pass's *status* is what withdraws it. That is the right
 * record — it is what a compensation case is settled from — but it means this
 * component can no longer read "is this finished?" off the counter alone.
 */
describe('a pass that can no longer be used', () => {
  it('does not advertise remaining sessions on a withdrawn Pass', () => {
    render(
      <SessionBalance
        pass={aPurchasedPass({
          status: 'CANCELLED',
          originalSessions: 10,
          usedSessions: 2,
          remainingSessions: 8,
        })}
      />,
    )

    // The counter still says 8, and saying so next to a Withdrawn badge is
    // exactly the confusion this guards against.
    expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument()
    expect(screen.getByText('2 of 10 sessions used')).toBeInTheDocument()
  })

  it('reads the same way for an expired Pass with sessions left on it', () => {
    render(
      <SessionBalance
        pass={aPurchasedPass({
          status: 'EXPIRED',
          originalSessions: 4,
          usedSessions: 1,
          remainingSessions: 3,
        })}
      />,
    )

    expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument()
    expect(screen.getByText('1 of 4 sessions used')).toBeInTheDocument()
  })

  it('still counts down on a Pass the customer can actually use', () => {
    render(
      <SessionBalance
        pass={aPurchasedPass({
          status: 'ACTIVE',
          originalSessions: 10,
          usedSessions: 2,
          remainingSessions: 8,
        })}
      />,
    )

    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText(/remaining/i)).toBeInTheDocument()
  })
})
