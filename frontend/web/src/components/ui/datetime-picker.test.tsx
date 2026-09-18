import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { DateTimePicker } from '@/components/ui/datetime-picker'

const NOON = new Date(2026, 8, 16, 12, 0, 0)

function Harness({
  initialDate = '',
  initialTime = '',
}: {
  initialDate?: string
  initialTime?: string
}) {
  const [date, setDate] = useState(initialDate)
  const [time, setTime] = useState(initialTime)
  return (
    <DateTimePicker
      date={date}
      time={time}
      locale="en-US"
      now={NOON}
      onChange={(next) => {
        setDate(next.date)
        setTime(next.time)
      }}
    />
  )
}

describe('DateTimePicker', () => {
  it('picks a date then a half-hour time', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Choose end date' }))
    expect(screen.getByRole('dialog', { name: 'Choose a date' })).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('September')).toBeInTheDocument()

    await user.click(screen.getByRole('gridcell', { name: /September 20/ }))

    expect(screen.getByRole('dialog', { name: 'Choose a time' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /End date,/ })).toHaveTextContent(/20 Sep/)

    await user.click(screen.getByRole('option', { name: '21:00' }))
    expect(screen.getByRole('button', { name: 'End time, 21:00' })).toBeInTheDocument()
  })

  it('clears the chosen instant', async () => {
    const user = userEvent.setup()
    render(<Harness initialDate="2026-10-01" initialTime="18:30" />)

    await user.click(screen.getByRole('button', { name: 'Remove end date' }))
    expect(screen.getByRole('button', { name: 'Choose end date' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose end time' })).toBeDisabled()
  })
})
