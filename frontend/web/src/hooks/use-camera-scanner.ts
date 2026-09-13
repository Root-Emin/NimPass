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
 *  2. No new dependency. Decoding uses the platform `BarcodeDetector` where the
 *     runtime has it, and where it does not, scanning is simply reported as
 *     unsupported and the typed-code path carries the flow. Pulling in a
 *     WASM QR decoder to cover that gap would add weight to every provider
 *     bundle for a fallback that already exists
 *     (docs/08-ARCHITECTURE.md §122, docs/09-SECURITY.md §97).
 *
 * Typing the code is a first-class path, not a consolation prize: Nimpass is
 * web-first, providers work on desktops, and redemption must not depend on a
 * phone camera (docs/01-PRODUCT.md §25, §40).
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

/** Scanning needs both halves: a camera to read from and a decoder to read with. */
function scanningSupported(): boolean {
  return cameraApiAvailable() && detectorCtor() !== null
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

    const Detector = detectorCtor()
    if (!Detector) {
      setStatus('unsupported')
      return
    }
    const detector = new Detector({ formats: ['qr_code'] })
    setStatus('scanning')

    loopRef.current = setInterval(() => {
      const element = videoRef.current
      if (!element || element.readyState < 2) return
      void detector
        .detect(element)
        .then((codes) => {
          const value = codes[0]?.rawValue?.trim()
          if (!value) return
          // One hit ends the scan: the camera should not keep running while the
          // provider is looking at a confirmation.
          stop()
          onDetectedRef.current(value)
        })
        .catch(() => {
          // A frame that cannot be decoded is the normal case, not an error.
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
