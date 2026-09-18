import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CoverControl } from '@/components/catalog/cover-control'
import { PassPreview } from '@/components/catalog/pass-preview'
import { mediaApi } from '@/api'
import { mockApi, ok } from '@/test/mock-api'
import { renderWithProviders } from '@/test/render'

afterEach(() => {
  vi.unstubAllGlobals()
})

const MEDIA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function Harness() {
  const [id, setId] = useState<string | null>(null)
  return <CoverControl mediaId={id} onChange={setId} />
}

describe('CoverControl', () => {
  it('uploads a jpeg and keeps the stored id', async () => {
    mockApi({
      'POST /api/v1/media': () =>
        ok(
          {
            id: MEDIA_ID,
            kind: 'pass_cover',
            contentType: 'image/jpeg',
            byteSize: 1200,
            createdAt: '2026-01-01T00:00:00Z',
          },
          201,
        ),
    })

    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'studio.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Pass photo'), file)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument()
    })
  })

  it('rejects an oversized photo before it leaves the browser', async () => {
    const { calls } = mockApi({ 'POST /api/v1/media': () => ok({}, 201) })
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    const file = new File([new Uint8Array(mediaApi.MEDIA_MAX_BYTES + 1)], 'cover.jpg', {
      type: 'image/jpeg',
    })
    await user.upload(screen.getByLabelText('Pass photo'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a photo smaller than 2 MB.')
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
  })

  it('sits on the artwork, not under the card', () => {
    render(
      <PassPreview
        title="10 Sessions"
        serviceName="Personal Training"
        providerName="Alex"
        sessions={10}
        priceLuna={null}
        accent="OLIVE"
        action={<CoverControl mediaId={null} onChange={() => {}} />}
      />,
    )

    const add = screen.getByRole('button', { name: 'Add photo' })
    expect(add.closest('[class*="aspect-[16/10]"]')).not.toBeNull()
    expect(screen.getByText('How this pass will look wherever customers browse it.')).toBeInTheDocument()
  })
})
