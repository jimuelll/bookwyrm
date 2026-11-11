import { useEffect, useState } from 'react'
import { useAuth } from '../features/auth/authContext'
import { useApi } from './api'
import { readCachedName, writeCachedName } from './displayNameCache'

/**
 * The reader's display name, without flashing a wrong one:
 *  1. the name remembered from the last visit, shown instantly;
 *  2. then the API's answer (saved name), which replaces it and is remembered for next time;
 *  3. only if the API can't be reached and nothing is remembered: their Google name, else the
 *     part of their email before the @.
 * Returns null while there's genuinely nothing to show yet (first visit, API still answering).
 */
export function useDisplayName(): string | null {
  const { user } = useAuth()
  const api = useApi()
  const userId = user?.id
  const [loaded, setLoaded] = useState<{ userId: string; name: string } | null>(null)
  // which account's request failed, so another account never inherits the failure
  const [failedFor, setFailedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let alive = true
    api<{ display_name: string }>('/profile')
      .then((p) => {
        if (!alive) return
        writeCachedName(userId, p.display_name)
        setLoaded({ userId, name: p.display_name })
      })
      .catch(() => alive && setFailedFor(userId)) // Settings shows the real error; here a fallback is enough
    return () => {
      alive = false
    }
  }, [api, userId])

  if (!user) return null
  if (loaded?.userId === user.id) return loaded.name
  const cached = readCachedName(user.id)
  if (cached) return cached
  return failedFor === user.id ? (user.name ?? user.email.split('@')[0]) : null
}
