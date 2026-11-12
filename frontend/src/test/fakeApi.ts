import { vi } from 'vitest'
import type { LibraryDocument } from '../app/documents'
import type { Quiz, QuizScope } from '../app/quizzes'

/** `url` is there for the few handlers that answer by query string (?topic=...) */
type Handler = (init: RequestInit, url: URL) => Response | Promise<Response>

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
      const parsed = new URL(url)
      const path = parsed.pathname
      calls.push({ method, path, auth: new Headers(init.headers).get('Authorization') })
      const handler = routes[`${method} ${path}`] ?? (method === 'GET' ? routes[path] : undefined)
      if (!handler) throw new TypeError('Failed to fetch')
      return handler(init, parsed)
    }),
  )
  return { calls }
}

export const profile = (display_name = 'Bookworm Ana') => () =>
  Response.json({ display_name, email: 'ana@school.edu', chosen: true })

/** A quiz as GET /quizzes/{id} returns it; ready, with 2 questions, unless told otherwise. */
export function quiz(over: Partial<Quiz> = {}): Quiz {
  return {
    id: 'quiz-1',
    document_id: 'doc-1',
    document_title: 'Cell Biology',
    status: 'ready',
    error: null,
    count: 2,
    topic: null,
    question_count: 2,
    difficulty: 'medium',
    types: ['mcq', 'true_false'],
    created_at: new Date().toISOString(),
    ...over,
  }
}

/** GET /documents/{id}/quiz-scope: a long PDF by default (8 suggested, up to 20). */
export function scope(over: Partial<QuizScope> = {}): QuizScope {
  return { topic: null, passages: 40, page_first: 1, page_last: 148, suggested_count: 8, max_count: 20, ...over }
}

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
