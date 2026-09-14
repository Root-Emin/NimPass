import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Camera scanning for the provider's redemption screen.
 *
 * Two rules shape this, both from the milestone brief §23:
 *
 *  1. Nothing here touches the camera until the provider explicitly asks. A
 *     permission prompt on page load is exactly the confirmation fatigue
 *     docs/04-NIMIQ-MINI-APPS.md §55-§56 warns against, and a provider opening
 *     their workspace has not asked to scan anything.
 *  2. Decoding is real on every runtime that has a camera. The platform
 *     `BarcodeDetector` is used where it exists, because it is free and
 *     hardware-accelerated — but it is Chromium-only. Safari and iOS WKWebView
 *     do not implement it, and Nimiq Pay runs on iOS, so relying on it alone
 *     meant a provider with an iPhone could not scan at all.
 *
 *     The fallback is `qr-scanner`, which Nimiq themselves maintain and ship in
 *     the Nimiq wallet — same ecosystem, proven in exactly this WebView. It is
 *     imported lazily, inside `start()`, so it costs nothing on any other route
 *     and nothing at all on runtimes that have the native detector
 *     (docs/08-ARCHITECTURE.md §122).
 *
 * Typing the code stays a first-class path regardless: Nimpass is web-first,
 * providers work on desktops, and redemption must never depend on a camera
 * (docs/01-PRODUCT.md §25, §40).
 */

export type CameraStatus =
  /** Nothing requested. No permission prompt has been shown. */
  | 'idle'
  /** Waiting on the browser's permission prompt. */
  | 'requesting'
  /** Live video, decoding frames. */
  | 'scanning'
  /** The provider declined, or the permission is blocked at browser level. */
  | 'denied'
  /** Permission granted, but the device exposes no camera. */
  | 'no-camera'
  /**
   * `getUserMedia` needs a secure context. LAN HTTP during Nimiq Pay testing is
   * not one, which is a case this project actually hits
   * (docs/04-NIMIQ-MINI-APPS.md §47).
   */
  | 'insecure-context'
  /** The runtime has no camera API, or no way to decode a QR code. */
  | 'unsupported'
  /** The camera existed but could not be started. */
  | 'error'

export interface CameraScanner {
  status: CameraStatus
  /** Attach to a `<video>`; only meaningful while scanning. */
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** Explicit provider action. This is the only thing that prompts. */
  start: () => Promise<void>
  stop: () => void
  /** True when this runtime could scan at all, before any permission question. */
  supported: boolean
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return typeof candidate === 'function' ? candidate : null
}

function cameraApiAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

/**
 * Scanning needs a camera. A decoder is always available now — native where the
 * runtime has one, `qr-scanner` where it does not — so camera access is the
 * only thing that can rule scanning out.
 */
function scanningSupported(): boolean {
  return cameraApiAvailable()
}

/** One decoded frame, or null. Both decoders are normalised to this. */
type DecodeFrame = (video: HTMLVideoElement) => Promise<string | null>

/**
 * Picks a decoder for this runtime.
 *
 * Native first: zero bytes, and the browser does the work off the main thread.
 * Otherwise `qr-scanner`, loaded on demand — the import only happens once a
 * provider has actually pressed Scan on a runtime that needs it.
 */
async function resolveDecoder(): Promise<DecodeFrame | null> {
  const Native = detectorCtor()
  if (Native) {
    const detector = new Native({ formats: ['qr_code'] })
    return async (video) => {
      const codes = await detector.detect(video)
      return codes[0]?.rawValue?.trim() ?? null
    }
  }

  try {
    const { default: QrScanner } = await import('qr-scanner')
    return async (video) => {
      try {
        const result = await QrScanner.scanImage(video, { returnDetailedScanResult: true })
        return result.data.trim() || null
      } catch {
        // No code in this frame. The normal case, not an error.
        return null
      }
    }
  } catch {
    // The decoder chunk could not be fetched — offline, or a blocked CDN.
    return null
  }
}

const DECODE_INTERVAL_MS = 250

export function useCameraScanner(onDetected: (value: string) => void): CameraScanner {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(true)

  // Held in a ref so the decode loop always calls the latest handler without
  // being torn down and restarted whenever the caller re-renders. Written in an
  // effect rather than during render: mutating a ref while rendering is a side
  // effect, and under StrictMode's double render it happens twice.
  const onDetectedRef = useRef(onDetected)
  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  const stop = useCallback(() => {
    if (loopRef.current) {
      clearInterval(loopRef.current)
      loopRef.current = null
    }
    // Releasing every track is what turns the device's camera light off.
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (mounted.current) setStatus('idle')
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (loopRef.current) clearInterval(loopRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    if (typeof window === 'undefined') return

    // Ordered so the provider gets the most specific explanation available,
    // and so an impossible case never produces a permission prompt.
    if (!window.isSecureContext) {
      setStatus('insecure-context')
      return
    }
    if (!scanningSupported()) {
      setStatus('unsupported')
      return
    }

    setStatus('requesting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Rear camera where there is one; browsers fall back on their own.
        video: { facingMode: 'environment' },
      })
    } catch (error) {
      if (!mounted.current) return
      setStatus(classifyCameraError(error))
      return
    }

    if (!mounted.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }

    streamRef.current = stream
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      // Autoplay policies reject this in some runtimes; scanning still works
      // from the stream, so a rejected play() is not a failure.
      void video.play().catch(() => {})
    }

    const decode = await resolveDecoder()
    if (!decode) {
      setStatus('unsupported')
      return
    }
    if (!mounted.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    setStatus('scanning')

    // Guards against a slow frame overlapping the next tick: decoding a 1080p
    // frame on a mid-range phone can outrun the interval, and stacking them
    // makes the camera stutter without finding codes any faster.
    let decoding = false

    loopRef.current = setInterval(() => {
      const element = videoRef.current
      if (!element || element.readyState < 2 || decoding) return
      decoding = true
      void decode(element)
        .then((value) => {
          if (!value) return
          // One hit ends the scan: the camera should not keep running while the
          // provider is looking at a confirmation — and scanning the same code
          // twice must not produce two lookups.
          stop()
          onDetectedRef.current(value)
        })
        .catch(() => {
          // A frame that cannot be decoded is the normal case, not an error.
        })
        .finally(() => {
          decoding = false
        })
    }, DECODE_INTERVAL_MS)
  }, [stop])

  return { status, videoRef, start, stop, supported: scanningSupported() }
}

/**
 * Maps a `getUserMedia` rejection to a state the provider can act on.
 *
 * The names come from the Media Capture spec's documented exceptions, so this
 * is classification rather than string-guessing.
 */
function classifyCameraError(error: unknown): CameraStatus {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera'
  // NotReadableError, AbortError, and anything undocumented: the camera exists
  // but could not be used, which is a different message from "you said no".
  return 'error'
}
