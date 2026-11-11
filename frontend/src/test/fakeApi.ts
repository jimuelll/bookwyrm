import { vi } from 'vitest'
import type { LibraryDocument } from '../app/documents'

type Handler = (init: RequestInit) => Response | Promise<Response>

/**
 * A fake of our API at the network boundary. Routes are "METHOD /path" (or just "/path" for GET);
 * anything not listed fails like an unreachable server. Returns every call made, for assertions.
 */
export function stubApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; auth: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = new URL(url).pathname
      calls.push({ method, path, auth: new Headers(init.headers).get('Authorization') })
      const handler = routes[`${method} ${path}`] ?? (method === 'GET' ? routes[path] : undefined)
      if (!handler) throw new TypeError('Failed to fetch')
      return handler(init)
    }),
  )
  return { calls }
}

export const profile = (display_name = 'Bookworm Ana') => () =>
  Response.json({ display_name, email: 'ana@school.edu', chosen: true })

let next = 0
/** A document as GET /documents returns it; ready unless told otherwise. */
export function book(over: Partial<LibraryDocument> = {}): LibraryDocument {
  next += 1
  return {
    id: `doc-${next}`,
    title: 'Cell Biology',
    filename: 'Cell_Biology.pdf',
    page_count: 148,
    status: 'ready',
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  }
}
