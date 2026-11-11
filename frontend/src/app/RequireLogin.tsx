import type { ReactNode } from 'react'
import { useAuth } from '../features/auth/authContext'

interface Props {
  /** Shown when logged out, e.g. "Log in to see your library". */
  title: string
  children: ReactNode
}

/** Renders a page only for a logged-in reader; otherwise explains why and offers Log in. (UX only; the API enforces auth.) */
export function RequireLogin({ title, children }: Props) {
  const { user, openLogin } = useAuth()
  if (user) return children
  return (
    <main className="sheet gate">
      <h1>{title}</h1>
      <p>Your PDFs, quizzes and stats are kept in your account.</p>
      <button type="button" className="btn btn-primary" onClick={openLogin}>Log in</button>
    </main>
  )
}
