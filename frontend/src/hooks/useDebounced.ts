import { useEffect, useState } from 'react'

/**
 * `value`, but only after it has stopped changing for `ms`. Used for search-as-you-type: asking the
 * server on every keystroke would send "o", "os", "osm"... when only "osmosis" matters.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer) // a new keystroke cancels the wait and starts it again
  }, [value, ms])
  return settled
}
