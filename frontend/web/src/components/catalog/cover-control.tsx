import { ImagePlus, Loader2, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { messageForApiError } from '@/api'
import { mediaApi } from '@/api'
import { cn } from '@/lib/utils'

const ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png'

/**
 * The photo control that sits on the pass cover.
 *
 * The whole artwork is the hit target — a camera on a colour field is where
 * people look for this, not a second row under the card. Upload happens
 * immediately so the preview is the stored image, not a local file the save
 * step might later refuse. The original name is never sent as authority —
 * the backend re-encodes and names the object itself (docs/09-SECURITY.md §83).
 */
export function CoverControl({
  mediaId,
  onChange,
  onBusy,
  disabled,
}: {
  mediaId: string | null
  onChange: (mediaId: string | null) => void
  onBusy?: (busy: boolean) => void
  disabled?: boolean
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setBusyState = (next: boolean) => {
    setBusy(next)
    onBusy?.(next)
  }

  const pick = () => {
    if (disabled || busy) return
    inputRef.current?.click()
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    const problem = clientReject(file)
    if (problem) {
      setError(problem)
      return
    }
    setBusyState(true)
    try {
      const stored = await mediaApi.uploadPassCover(file)
      onChange(stored.id)
    } catch (err) {
      setError(messageForApiError(err))
    } finally {
      setBusyState(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="relative size-full">
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label="Pass photo"
        disabled={disabled || busy}
        onChange={(event) => void onFile(event.target.files?.[0])}
      />

      <button
        type="button"
        onClick={pick}
        disabled={disabled || busy}
        aria-label={mediaId ? 'Change photo' : 'Add photo'}
        className={cn(
          'absolute inset-0',
          'transition-colors duration-[--nimpass-duration-fast] ease-[--nimpass-ease]',
          'hover:bg-black/10 focus-visible:bg-black/10',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white',
          'disabled:pointer-events-none',
        )}
      />

      <div
        className={cn(
          'pointer-events-none absolute inset-x-5 bottom-5 flex items-center justify-end gap-2 sm:inset-x-6 sm:bottom-6',
          disabled && 'opacity-60',
        )}
      >
        {mediaId && !busy ? (
          <button
            type="button"
            onClick={() => {
              setError(null)
              onChange(null)
            }}
            disabled={disabled}
            aria-label="Remove photo"
            className={cn(
              'pointer-events-auto flex size-11 items-center justify-center rounded-full bg-white text-ink shadow-lift',
              'transition-transform duration-[--nimpass-duration-base] ease-[--nimpass-ease] hover:scale-105 active:scale-95',
              'disabled:pointer-events-none disabled:opacity-60',
            )}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <span
          aria-hidden="true"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-3.5 text-small font-medium text-ink shadow-lift"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus className="size-4" aria-hidden="true" />
          )}
          {busy ? 'Uploading' : mediaId ? 'Change photo' : 'Add photo'}
        </span>
      </div>

      {error ? (
        <p
          className="absolute inset-x-5 top-5 z-10 rounded-xl bg-surface px-3 py-2 text-small text-danger shadow-lift"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

function clientReject(file: File): string | null {
  if (file.size > mediaApi.MEDIA_MAX_BYTES) {
    return 'Choose a photo smaller than 2 MB.'
  }
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  const typedOk = type === 'image/jpeg' || type === 'image/png'
  const namedOk = name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png')
  if (!typedOk && !namedOk) {
    return 'Use a JPEG or PNG photo.'
  }
  return null
}
