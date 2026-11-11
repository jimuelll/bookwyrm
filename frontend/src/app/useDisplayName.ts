import { useEffect, useState } from 'react'
import { useAuth } from '../features/auth/authContext'
import { useApi } from './api'

/**
 * The reader's display name: the one saved in Settings (from our API), or until that loads or if the
 * API is unreachable, their Google name, else the part of their email before the @.
 */
export function useDisplayName(): string {
  const { user } = useAuth()
  const api = useApi()
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let alive = true
    api<{ display_name: string }>('/profile')
      .then((p) => alive && setSaved(p.display_name))
      .catch(() => {}) // the fallback below is good enough to show; Settings reports real errors
    return () => {
      alive = false
    }
  }, [api, user])

  return saved ?? user?.name ?? user?.email.split('@')[0] ?? 'Reader'
}
