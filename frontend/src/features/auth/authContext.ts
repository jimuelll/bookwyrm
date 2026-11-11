import { createContext, useContext } from 'react'
import type { AuthBackend } from './authBackend'

export interface User {
  id: string
  email: string
}

export interface LoginPrompt {
  /** Shown under the modal's heading, e.g. "You need an account to upload a PDF." */
  reason?: string
  /** Which form the modal opens on; "Get started" opens on sign-up. Defaults to log in. */
  mode?: 'login' | 'signup'
  /**
   * Where to land after a login that leaves the page (Google, or the link in a confirmation email).
   * Those can't run a JavaScript callback when they come back, so they return to this path instead.
   */
  next?: string
}

export interface Auth {
  user: User | null
  /** False until the saved session has been checked, so pages don't flash "log in" for a logged-in reader. */
  ready: boolean
  backend: AuthBackend
  /**
   * The login gate (PRD 7.10). Runs `action` right away when someone is logged in; otherwise opens
   * the login modal and runs `action` once they log in with a password.
   * This is only UX: the API must still refuse every request without a valid token.
   */
  requireAuth: (action: () => void, prompt?: LoginPrompt) => void
  openLogin: (prompt?: LoginPrompt) => void
  signOut: () => Promise<void>
}

export const AuthContext = createContext<Auth | null>(null)

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
