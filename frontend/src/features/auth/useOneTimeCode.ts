import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AuthError } from './authBackend'
import { useAuth } from './authContext'

export type CodeState =
  | { status: 'working' }
  | { status: 'done' }
  | { status: 'none' } // the page was opened without a code
  | { status: 'failed'; message: string }

/**
 * Redeem the one-time `?code=` that Supabase put on an emailed link or Google redirect.
 *
 * A code works once. React's StrictMode runs effects twice in development, so a ref makes sure
 * the code is sent only once; the second run would otherwise fail with "code already used".
 */
export function useOneTimeCode(): CodeState {
  const { backend } = useAuth()
  const [params] = useSearchParams()
  const code = params.get('code')
  // Supabase reports problems (expired link, cancelled Google sign-in) as ?error_description=...
  const reported = params.get('error_description')
  const [state, setState] = useState<CodeState>(
    reported ? { status: 'failed', message: reported } : code ? { status: 'working' } : { status: 'none' },
  )
  const started = useRef(false)

  useEffect(() => {
    if (!code || reported || started.current) return
    started.current = true
    backend
      .exchangeCode(code)
      .then(() => setState({ status: 'done' }))
      .catch((e: unknown) =>
        setState({ status: 'failed', message: e instanceof AuthError ? e.message : 'This link did not work.' }),
      )
  }, [backend, code, reported])

  return state
}
