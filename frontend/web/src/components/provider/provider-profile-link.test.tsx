import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { ProviderProfileLink } from '@/components/provider/provider-profile-link'
import { aPublicProvider } from '@/test/mock-api'

describe('ProviderProfileLink', () => {
  it('names the provider and links to the stable slug, without printing the wallet', () => {
    const provider = aPublicProvider()
    render(
      <MemoryRouter>
        <ProviderProfileLink provider={provider} />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: /Alex Fitness/ })
    expect(link).toHaveAttribute('href', '/providers/alex-fitness')
    expect(screen.getByText('Provided by')).toBeInTheDocument()
    expect(link.textContent).not.toMatch(/NQ[0-9A-Z]/)
  })
})
