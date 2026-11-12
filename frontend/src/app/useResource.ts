import { useCallback, useEffect, useState } from 'react'
import { ApiError, useApi } from './api'

export const POLL_MS = 1500

interface Loaded<T> {
  path: string
  data: T | null
  error: string | null
}

/**
 * GET one thing from our API and keep it: `data` is null until it arrives, `error` is set if it couldn't
 * be fetched. With `pollWhile`, asks again every 1.5 s for as long as that says so (a quiz that is still
 * being written), then stops. This is polling: simple, and fine for a wait of seconds to a minute; the
 * server pushing updates (SSE, WebSockets) would only be worth it for something more frequent.
 */
export function useResource<T>(path: string | null, options: { pollWhile?: (data: T) => boolean } = {}) {
  const api = useApi()
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) return
    let alive = true // the answer to a request for a page we've since left is dropped
    api<T>(path).then(
      (data) => alive && setLoaded({ path, data, error: null }),
      (e: unknown) =>
        alive &&
        setLoaded((before) => ({
          path,
          data: before?.path === path ? before.data : null, // a failed re-check keeps what we had
          error: e instanceof ApiError ? e.message : 'Something went wrong. Try again.',
        })),
    )
    return () => {
      alive = false
    }
  }, [api, path, tick])

  // what was loaded for another path (the page before this one) is never shown as this one's
  const current = loaded?.path === path ? loaded : null
  const data = current?.data ?? null
  const polling = data !== null && (options.pollWhile?.(data) ?? false)
  useEffect(() => {
    if (!polling) return
    const timer = setTimeout(() => setTick((n) => n + 1), POLL_MS)
    return () => clearTimeout(timer)
  }, [polling, loaded])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, error: data === null ? (current?.error ?? null) : null, reload }
}
