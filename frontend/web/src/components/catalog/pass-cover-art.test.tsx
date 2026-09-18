import { render } from '@testing-library/react'

import { PassCoverArt } from '@/components/catalog/pass-cover-art'
import { PASS_COVER_RATIO_CLASS } from '@/components/catalog/pass-cover-ratios'

const TONE = { from: '#3f4f2f', to: '#1f2918' }

function frameOf(container: HTMLElement) {
  return container.querySelector('[class*="aspect-[16/10]"]')
}

describe('PassCoverArt', () => {
  it('keeps the shared 16/10 frame for a photograph and for the accent field', () => {
    const { container, rerender } = render(
      <PassCoverArt seed="Alex" tone={TONE} coverSrc={null} />,
    )
    expect(frameOf(container)).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()

    rerender(
      <PassCoverArt seed="Alex" tone={TONE} coverSrc="/api/v1/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" />,
    )
    const photo = container.querySelector('img')
    expect(photo).not.toBeNull()
    expect(photo).toHaveClass('object-cover', 'object-center', 'absolute', 'inset-0')
    expect(photo?.closest('[class*="aspect-[16/10]"]')).not.toBeNull()
  })

  it('exports one ratio so cards and skeletons cannot drift', () => {
    expect(PASS_COVER_RATIO_CLASS).toBe('aspect-[16/10]')
  })
})
