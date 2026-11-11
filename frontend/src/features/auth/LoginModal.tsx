import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CrossIcon, GoogleMark, WyrmMark } from '../../components/icons'
import { AuthError, emailSignIn, googleSignIn, type EmailMode } from './authClient'
import type { User } from './authContext'
import './auth.css'

interface Props {
  open: boolean
  /** Why the modal opened, e.g. "You need an account to upload a PDF." Omitted when opened from the Log in link. */
  reason?: string
  onClose: () => void
  onSignedIn: (user: User) => void
}

/**
 * The login modal: Continue with Google, or email + password (log in or create an account).
 * A native <dialog> opened with showModal(), so the browser handles the focus trap, Esc,
 * hiding the page behind it from screen readers, and returning focus to the opener on close.
 */
export function LoginModal({ open, reason, onClose, onSignedIn }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="auth"
      aria-labelledby="auth-title"
      // Esc and the × both end here; close() fires this too, so keep React's state in step
      onClose={() => { if (open) onClose() }}
      // a click on the backdrop lands on the dialog element itself
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* the form only exists while open, so every opening starts clean */}
      {open && <AuthForm reason={reason} onClose={onClose} onSignedIn={onSignedIn} />}
    </dialog>
  )
}

function AuthForm({ reason, onClose, onSignedIn }: Omit<Props, 'open'>) {
  const [mode, setMode] = useState<EmailMode>('login')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const uid = useId()
  const signup = mode === 'signup'

  async function run(attempt: () => Promise<User>) {
    setBusy(true)
    setError('')
    try {
      onSignedIn(await attempt())
    } catch (e) {
      setError(e instanceof AuthError ? e.message : 'Something went wrong. Try again.')
      setBusy(false)
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    // checked here rather than by the browser so the message is in our voice and in one place
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter your email address, like name@school.edu.')
    if (signup && password.length < 8) return setError('Use a password of at least 8 characters.')
    if (!password) return setError('Enter your password.')
    run(() => emailSignIn({ mode, email, password }))
  }

  function switchMode() {
    setMode(signup ? 'login' : 'signup')
    setError('')
  }

  return (
    <div className="auth-page">
      <div className="auth-head">
        <span className="auth-brand"><WyrmMark />Bookwyrm</span>
        <button type="button" className="auth-close" aria-label="Close" onClick={onClose}>
          <CrossIcon />
        </button>
      </div>

      <h2 id="auth-title">{signup ? 'Create your account' : 'Log in'}</h2>
      <p className="auth-reason">{reason ?? 'Your PDFs and quizzes are kept in your account.'}</p>

      <button type="button" className="btn btn-outline auth-google" disabled={busy} onClick={() => run(googleSignIn)}>
        <GoogleMark />
        Continue with Google
      </button>

      <p className="auth-or" aria-hidden="true"><span>or</span></p>

      <form className="auth-form" noValidate onSubmit={submit} aria-describedby={error ? `${uid}-err` : undefined}>
        <label htmlFor={`${uid}-email`}>Email</label>
        <input id={`${uid}-email`} name="email" type="email" autoComplete="email" inputMode="email" required />

        <label htmlFor={`${uid}-pw`}>Password</label>
        <input
          id={`${uid}-pw`}
          name="password"
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          minLength={signup ? 8 : undefined}
          aria-describedby={signup ? `${uid}-pw-hint` : undefined}
          required
        />
        {signup && <p className="auth-hint" id={`${uid}-pw-hint`}>At least 8 characters.</p>}

        <p className="auth-error" id={`${uid}-err`} role="alert">{error}</p>

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {signup ? 'Create account' : 'Log in'}
        </button>
      </form>

      <p className="auth-switch">
        {signup ? 'Already have an account?' : 'New to Bookwyrm?'}{' '}
        <button type="button" className="text-link" onClick={switchMode}>
          {signup ? 'Log in' : 'Create an account'}
        </button>
      </p>
    </div>
  )
}
