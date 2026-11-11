import { useEffect } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { usePageTitle } from '../../app/shell'
import { WyrmLoader } from '../../components/inkWyrm/WyrmLoader'
import { safeNext } from './authBackend'
import { useAuth } from './authContext'
import { useOneTimeCode } from './useOneTimeCode'

/**
 * Where Google sign-in and the email confirmation link return to (/auth/callback?code=...&next=/library).
 * It redeems the code for a session, then continues to `next`.
 */
export function AuthCallbackPage() {
  usePageTitle('Logging in')
  const state = useOneTimeCode()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const { openLogin } = useAuth()

  useEffect(() => {
    if (state.status === 'done') navigate(next, { replace: true })
  }, [state.status, next, navigate])

  if (state.status === 'none') return <Navigate to="/" replace />
  if (state.status === 'failed') {
    return (
      <main className="sheet gate">
        <h1>We couldn't log you in from this link</h1>
        {/* A confirmation link opened in a different browser still confirms the email on Supabase's side,
            but the one-time code can only be redeemed in the browser that asked for it. */}
        <p>
          {state.message} If you were confirming your email, it is probably confirmed already: log in to continue.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => openLogin({ next })}>Log in</button>
      </main>
    )
  }
  return (
    <main className="sheet" aria-busy="true">
      <WyrmLoader label="Logging you in…" heading />
    </main>
  )
}
