import { useEffect, useRef, useState } from 'react'

/**
 * Tracks whether an element is on screen.
 *
 * Used to reveal the mobile purchase bar only once the real purchase panel has
 * scrolled away, so the page never shows two competing primary actions.
 * Assumes "visible" where IntersectionObserver is unavailable, which keeps the
 * duplicate bar hidden rather than stuck on.
 */
export function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(true)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver !== 'function') return

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? true),
      { threshold: 0 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, inView }
}
