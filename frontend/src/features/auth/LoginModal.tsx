import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CrossIcon, GoogleMark, WyrmMark } from '../../components/icons'
import { AuthError, safeNext, type AuthBackend } from './authBackend'
import type { User } from './authContext'
import './auth.css'

type Mode = 'login' | 'signup' | 'forgot'
type Sent = { kind: 'confirm' | 'reset'; email: string }

interface Props {
  open: boolean
  /** Why the modal opened, e.g. "You need an account to upload a PDF." Omitted when opened from the Log in link. */
  reason?: string
  initialMode?: 'login' | 'signup'
  /** Where Google or an emailed link should land after logging in. */
  next?: string
  backend: AuthBackend
  onClose: () => void
  onSignedIn: (user: User) => void
}

/**
 * The login modal: Continue with Google, or email + password (log in, create an account, or reset
 * a forgotten password). A native <dialog> opened with showModal(), so the browser handles the focus
 * trap, Esc, hiding the page behind it from screen readers, and returning focus to the opener.
 */
export function LoginModal({ open, onClose, ...rest }: Props) {
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
      {open && <AuthForm onClose={onClose} {...rest} />}
    </dialog>
  )
}

const TITLES: Record<Mode, string> = { login: 'Log in', signup: 'Create your account', forgot: 'Reset your password' }

function AuthForm({ reason, initialMode = 'login', next, backend, onClose, onSignedIn }: Omit<Props, 'open'>) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<AuthError | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<Sent | null>(null)
  const [resent, setResent] = useState(false)
  const uid = useId()
  const after = safeNext(next)
  const signup = mode === 'signup'

  async function run(attempt: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await attempt()
    } catch (e) {
      setError(e instanceof AuthError ? e : new AuthError('Something went wrong. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const address = email.trim()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password') ?? '')
    // checked here rather than by the browser so the message is in our voice and in one place
    if (!/^\S+@\S+\.\S+$/.test(address)) return setError(new AuthError('Enter your email address, like name@school.edu.'))
    if (mode === 'forgot') {
      return run(async () => {
        await backend.sendPasswordReset(address)
        setSent({ kind: 'reset', email: address })
      })
    }
    if (signup && password.length < 8) return setError(new AuthError('Use a password of at least 8 characters.'))
    if (!password) return setError(new AuthError('Enter your password.'))
    // a typo in a password you can't see would lock you out of the account you just made
    if (signup && password !== form.get('confirm')) return setError(new AuthError('The two passwords are different.'))
    if (signup) {
      return run(async () => {
        await backend.signUp(address, password, after)
        setSent({ kind: 'confirm', email: address })
      })
    }
    run(async () => onSignedIn(await backend.signIn(address, password)))
  }

  function resend(address: string) {
    run(async () => {
      await backend.resendConfirmation(address, after)
      setResent(true)
    })
  }

  function go(to: Mode) {
    setMode(to)
    setError(null)
    setSent(null)
    setResent(false)
  }

  const head = (
    <div className="auth-head">
      <span className="auth-brand"><WyrmMark />Bookwyrm</span>
      <button type="button" className="auth-close" aria-label="Close" onClick={onClose}>
        <CrossIcon />
      </button>
    </div>
  )

  if (sent) {
    return (
      <div className="auth-page">
        {head}
        <h2 id="auth-title">Check your email</h2>
        {sent.kind === 'confirm' ? (
          <p className="auth-reason">
            We sent a link to <strong>{sent.email}</strong>. Open it to confirm your address and finish creating your account.
          </p>
        ) : (
          <p className="auth-reason">
            If there is an account for <strong>{sent.email}</strong>, we sent it a link to set a new password.
          </p>
        )}
        <p className="auth-error" role="alert">{error?.message}</p>
        {resent && <p className="auth-note" role="status">Sent again. It can take a minute to arrive.</p>}
        <p className="auth-switch">
          {sent.kind === 'confirm' && !resent && (
            <>
              <button type="button" className="text-link" disabled={busy} onClick={() => resend(sent.email)}>
                Resend the email
              </button>
              {' · '}
            </>
          )}
          <button type="button" className="text-link" onClick={() => go('login')}>Back to log in</button>
        </p>
      </div>
    )
  }

  return (
    <div className="auth-page">
      {head}
      <h2 id="auth-title">{TITLES[mode]}</h2>
      <p className="auth-reason">
        {mode === 'forgot'
          ? "Enter your account's email and we'll send you a link to set a new password."
          : (reason ?? 'Your PDFs and quizzes are kept in your account.')}
      </p>

      {mode !== 'forgot' && (
        <>
          <button
            type="button"
            className="btn btn-outline auth-google"
            disabled={busy}
            onClick={() => run(() => backend.signInWithGoogle(after))}
          >
            <GoogleMark />
            Continue with Google
          </button>
          <p className="auth-or" aria-hidden="true"><span>or</span></p>
        </>
      )}

      <form className="auth-form" noValidate onSubmit={submit} aria-describedby={error ? `${uid}-err` : undefined}>
        <label htmlFor={`${uid}-email`}>Email</label>
        <input
          id={`${uid}-email`}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {mode !== 'forgot' && (
          <>
            <div className="auth-label-row">
              <label htmlFor={`${uid}-pw`}>Password</label>
              {mode === 'login' && (
                <button type="button" className="auth-forgot" onClick={() => go('forgot')}>Forgot password?</button>
              )}
            </div>
            <input
              id={`${uid}-pw`}
              name="password"
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              minLength={signup ? 8 : undefined}
              aria-describedby={signup ? `${uid}-pw-hint` : undefined}
              required
            />
            {signup && (
              <>
                <p className="auth-hint" id={`${uid}-pw-hint`}>At least 8 characters.</p>
                <label htmlFor={`${uid}-confirm`}>Type it again</label>
                <input id={`${uid}-confirm`} name="confirm" type="password" autoComplete="new-password" required />
              </>
            )}
          </>
        )}

        <p className="auth-error" id={`${uid}-err`} role="alert">
          {error?.message}
          {error?.code === 'email_not_confirmed' && (
            <>
              {' '}
              <button type="button" className="auth-inline" disabled={busy} onClick={() => resend(email.trim())}>
                Resend the link
              </button>
            </>
          )}
        </p>
        {resent && mode === 'login' && <p className="auth-note" role="status">Sent. Check your email.</p>}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {mode === 'forgot' ? 'Send reset link' : signup ? 'Create account' : 'Log in'}
        </button>
      </form>

      <p className="auth-switch">
        {mode === 'forgot' ? (
          <button type="button" className="text-link" onClick={() => go('login')}>Back to log in</button>
        ) : (
          <>
            {signup ? 'Already have an account?' : 'New to Bookwyrm?'}{' '}
            <button type="button" className="text-link" onClick={() => go(signup ? 'login' : 'signup')}>
              {signup ? 'Log in' : 'Create an account'}
            </button>
          </>
        )}
      </p>
    </div>
  )
}
