import { useEffect, useRef } from 'react'

/**
 * Runs a revalidation when the app comes back to the foreground.
 *
 * Mobile browsers and WebViews throttle or suspend timers in a backgrounded
 * tab, and Nimpass has two screens where that is actively dangerous rather than
 * merely stale:
 *
 *  - A redemption QR carries a countdown. Lock the phone for six minutes and
 *    the interval may not have run: the code is dead server-side while the
 *    screen still reads "expires in 3:00". The customer then shows a provider a
 *    reference that can only fail.
 *  - A purchase waiting on macro-block finality polls for its outcome. Suspend
 *    that and the customer returns to a spinner that stopped meaning anything.
 *
 * Both are cases where the honest move on return is the same: stop trusting
 * local state and ask the backend. This hook is that trigger, and nothing more
 * — it holds no state and decides no outcome.
 *
 * `pagehide`/`pageshow` are listened to alongside `visibilitychange` because
 * iOS restores pages from its back-forward cache without firing a visibility
 * change, which is exactly the Nimiq Pay WebView case.
 */
export function useRevalidateOnForeground(revalidate: () => void, enabled = true) {
  // Held in a ref so a caller re-rendering does not detach and reattach the
  // listeners on every render.
  const latest = useRef(revalidate)
  useEffect(() => {
    latest.current = revalidate
  }, [revalidate])

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return

    const onVisible = () => {
      if (document.visibilityState === 'visible') latest.current()
    }
    const onPageShow = () => latest.current()

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [enabled])
}
