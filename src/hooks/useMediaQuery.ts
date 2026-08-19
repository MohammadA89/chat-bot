import { useEffect, useState } from 'react'

/** Breakpoint where the sidebar turns into an overlay drawer. */
export const MOBILE_QUERY = '(max-width: 860px)'

function matches(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches
}

/** Reactive `matchMedia`, so layout decisions survive resize and rotation. */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query))

  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setValue(event.matches)
    setValue(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return value
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}

/** Read the breakpoint once, for state initialisers that run before effects. */
export function isMobileViewport(): boolean {
  return matches(MOBILE_QUERY)
}
