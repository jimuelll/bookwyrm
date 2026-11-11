import { useCallback } from 'react'
import { useAuth } from '../features/auth/authContext'

export const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')

/** A failed API call, with a message written for the reader. `status` is 0 when the server couldn't be reached. */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const FALLBACK: Record<number, string> = {
  401: 'Your session has expired. Log in again.',
  503: 'This part of Bookwyrm is not set up yet.',
}

/**
 * Call our API with the reader's Supabase access token as `Authorization: Bearer ...`.
 * The API checks that token on every request; the browser never talks to the database directly.
 */
export async function apiFetch<T>(token: string | null, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError("Couldn't reach the Bookwyrm server. Check your connection and try again.", 0)
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(errorMessage(response.status, body), response.status)
  }
  if (response.status === 204) return undefined as T // "No Content", e.g. after a DELETE
  return (await response.json()) as T
}

/** The message for a failed call: our API sends {"detail": "message for the reader"} for errors it expects. */
export function errorMessage(status: number, body: unknown): string {
  const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null
  return typeof detail === 'string' ? detail : (FALLBACK[status] ?? 'Something went wrong. Try again.')
}

/** `apiFetch` with the current reader's token filled in. */
export function useApi() {
  const { backend } = useAuth()
  return useCallback(
    async <T,>(path: string, init?: RequestInit) => apiFetch<T>(await backend.getAccessToken(), path, init),
    [backend],
  )
}
