import { useEffect, useState } from 'react'

// Keeps a lazily-loaded modal mounted for `delay` ms after it closes, so a
// chunk that was split out doesn't unmount mid-exit-animation (and so slow
// chunk fetches only happen on first open, not every open).
export default function useKeepMounted(open, delay = 300) {
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return undefined
    }
    const t = setTimeout(() => setMounted(false), delay)
    return () => clearTimeout(t)
  }, [open, delay])

  return mounted
}
