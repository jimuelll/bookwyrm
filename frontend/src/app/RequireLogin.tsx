import type { ReactNode } from 'react'
import { WyrmLoader } from '../components/inkWyrm/WyrmLoader'
import { useAuth } from '../features/auth/authContext'

interface Props {
  /** Shown when logged out, e.g. "Log in to see your library". */
  title: string
  children: ReactNode
}

/** Renders a page only for a logged-in reader; otherwise explains why and offers Log in. (UX only; the API enforces auth.) */
export function RequireLogin({ title, children }: Props) {
  const { user, ready, openLogin } = useAuth()
  if (user) return children
  // still checking for a saved session: wait, rather than flash "log in" at a logged-in reader
  if (!ready) {
    return (
      <main className="sheet" aria-busy="true">
        <WyrmLoader label="Opening your shelves…" heading />
      </main>
    )
  }
  return (
    <main className="sheet gate">
      <h1>{title}</h1>
      <p>Your PDFs, quizzes and stats are kept in your account.</p>
      <button type="button" className="btn btn-primary" onClick={() => openLogin({ next: window.location.pathname })}>Log in</button>
    </main>
  )
}
