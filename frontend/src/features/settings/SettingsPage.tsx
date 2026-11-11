import { useEffect, useId, useState, type FormEvent } from 'react'
import { ApiError, useApi } from '../../app/api'
import { usePageTitle } from '../../app/shell'
import { useAuth } from '../auth/authContext'
import './settings.css'

interface Profile {
  display_name: string
  email: string | null
  /** false until the reader saves a name; until then the name shown is only a suggestion */
  chosen: boolean
}

const MAX = 40

/** Account settings. For now: the display name shown on quiz leaderboards. */
export function SettingsPage() {
  usePageTitle('Settings')
  const api = useApi()
  const { user } = useAuth()
  const uid = useId()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api<Profile>('/profile')
      .then((p) => {
        if (!alive) return
        setProfile(p)
        setName(p.display_name)
      })
      .catch((e: unknown) => alive && setLoadError(e instanceof ApiError ? e.message : 'Could not load your settings.'))
    return () => {
      alive = false
    }
  }, [api])

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaved(false)
    // a quick check for instant feedback; the server checks again and has the final say
    if (!name.trim()) return setError('Enter a display name.')
    setBusy(true)
    setError('')
    try {
      const updated = await api<Profile>('/profile', { method: 'PUT', body: JSON.stringify({ display_name: name }) })
      setProfile(updated)
      setName(updated.display_name) // the server may have tidied it, e.g. extra spaces
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="sheet settings">
      <h1>Settings</h1>

      <section className="settings-section" aria-labelledby={`${uid}-profile`}>
        <h2 id={`${uid}-profile`}>Profile</h2>
        {loadError ? (
          <p className="auth-error" role="alert">{loadError}</p>
        ) : !profile ? (
          <p className="settings-loading" aria-busy="true">Loading…</p>
        ) : (
          <form className="auth-form settings-form" noValidate onSubmit={save}>
            <label htmlFor={`${uid}-name`}>Display name</label>
            <input
              id={`${uid}-name`}
              name="display_name"
              autoComplete="nickname"
              maxLength={MAX}
              value={name}
              aria-describedby={`${uid}-name-hint`}
              onChange={(e) => {
                setName(e.target.value)
                setSaved(false)
              }}
            />
            <p className="auth-hint" id={`${uid}-name-hint`}>
              Shown to others on quiz leaderboards. Up to {MAX} characters.
              {!profile.chosen && ' This one comes from your account; save it to keep it or change it.'}
            </p>

            <p className="auth-error" role="alert">{error}</p>
            <div className="settings-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
              <span className="auth-note" role="status">{saved ? 'Saved.' : ''}</span>
            </div>

            <dl className="settings-facts">
              <dt>Email</dt>
              <dd>{profile.email ?? user?.email}</dd>
            </dl>
          </form>
        )}
      </section>
    </main>
  )
}
