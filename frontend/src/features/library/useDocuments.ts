import { useCallback, useEffect, useState } from 'react'
import { ApiError, useApi } from '../../app/api'
import { isReading, type LibraryDocument } from '../../app/documents'
import { useUploads } from '../../app/upload/uploadContext'

export const POLL_MS = 1500

/**
 * The reader's books, newest first. While any is still being read, asks again every 1.5 s so its status
 * moves along (queued, reading pages, marking passages, ready) without a reload; stops once all are
 * ready or failed. A finished upload (from any page) triggers a fresh fetch too.
 */
export function useDocuments() {
  const api = useApi()
  const { last } = useUploads()
  const [docs, setDocs] = useState<LibraryDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    api<LibraryDocument[]>('/documents')
      .then((list) => {
        if (!alive) return
        setDocs(list)
        setError(null)
      })
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'))
    return () => {
      alive = false
    }
  }, [api, last, tick])

  // polling: one timer at a time, re-armed after each answer, only while something is being read
  const reading = docs?.some((d) => isReading(d.status)) ?? false
  useEffect(() => {
    if (!reading) return
    const timer = setTimeout(() => setTick((n) => n + 1), POLL_MS)
    return () => clearTimeout(timer)
  }, [reading, docs])

  const retry = useCallback(() => setTick((n) => n + 1), [])
  const remove = useCallback(
    async (id: string) => {
      await api<void>(`/documents/${id}`, { method: 'DELETE' })
      setDocs((list) => list?.filter((d) => d.id !== id) ?? null)
    },
    [api],
  )

  return { docs, error, retry, remove }
}
