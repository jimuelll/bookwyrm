import { useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { usePageTitle } from '../../app/shell'
import { AuthError } from './authBackend'
import { useAuth } from './authContext'
import { useOneTimeCode } from './useOneTimeCode'
import './auth.css'

/** The page the password-reset email links to (/auth/reset?code=...): choose a new password. */
export function ResetPasswordPage() {
  usePageTitle('Set a new password')
  const state = useOneTimeCode()
  const { backend, user, openLogin } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const uid = useId()

  // the code turns into a short "recovery" session; without one there is nobody to set a password for
  const canSet = state.status === 'done' || (state.status === 'none' && user)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const password = String(data.get('password') ?? '')
    if (password.length < 8) return setError('Use a password of at least 8 characters.')
    if (password !== data.get('confirm')) return setError('The two passwords are different.')
    setBusy(true)
    setError('')
    try {
      await backend.updatePassword(password)
      navigate('/library', { replace: true })
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.')
      setBusy(false)
    }
  }

  if (state.status === 'working') {
    return (
      <main className="sheet gate" aria-busy="true">
        <h1>Checking your link…</h1>
      </main>
    )
  }
  if (!canSet) {
    return (
      <main className="sheet gate">
        <h1>This reset link has expired</h1>
        <p>{state.status === 'failed' ? state.message : 'Reset links work once and only for a short time.'} Ask for a new one.</p>
        <button type="button" className="btn btn-primary" onClick={() => openLogin()}>Back to log in</button>
      </main>
    )
  }
  return (
    <main className="sheet gate reset">
      <h1>Set a new password</h1>
      <form className="auth-form reset-form" noValidate onSubmit={submit}>
        <label htmlFor={`${uid}-pw`}>New password</label>
        <input id={`${uid}-pw`} name="password" type="password" autoComplete="new-password" minLength={8} required />
        <label htmlFor={`${uid}-confirm`}>Type it again</label>
        <input id={`${uid}-confirm`} name="confirm" type="password" autoComplete="new-password" required />
        <p className="auth-hint">At least 8 characters.</p>
        <p className="auth-error" role="alert">{error}</p>
        <button type="submit" className="btn btn-primary" disabled={busy}>Save password</button>
      </form>
    </main>
  )
}
