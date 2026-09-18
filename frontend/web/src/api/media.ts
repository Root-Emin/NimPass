import { apiRequest, getApiBaseUrl } from './client'

/**
 * A stored cover (`Media`).
 *
 * The original filename never comes back. The server re-encodes every upload
 * as JPEG and names it by UUID (docs/09-SECURITY.md §83).
 */
export interface MediaObject {
  id: string
  kind: 'pass_cover'
  contentType: 'image/jpeg'
  byteSize: number
  createdAt: string
}

export const MEDIA_MAX_BYTES = 2 * 1024 * 1024

/** POST /media → 201 `Media`. Field name is `file`. */
export function uploadPassCover(file: File, signal?: AbortSignal): Promise<MediaObject> {
  const body = new FormData()
  body.append('file', file)
  return apiRequest<MediaObject>('/api/v1/media', { method: 'POST', body, signal })
}

/** Path the contract returns as `Pass.coverUrl`. */
export function mediaPath(id: string): string {
  return `/api/v1/media/${id}`
}

const MEDIA_PATH =
  /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Turn a contract coverUrl into an `<img src>`.
 *
 * Only the media collection on this API is accepted. A remote URL, a
 * javascript: value, or any other path is dropped rather than rendered.
 */
export function resolveCoverUrl(coverUrl: string | null | undefined): string | null {
  if (!coverUrl || !MEDIA_PATH.test(coverUrl)) return null
  const base = getApiBaseUrl()
  if (!base || base === '/') return coverUrl
  return `${base}${coverUrl}`
}
