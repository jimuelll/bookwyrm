import { createContext, useContext } from 'react'

export interface User {
  email: string
}

export interface LoginPrompt {
  /** Shown under the modal's heading, e.g. "You need an account to upload a PDF." */
  reason?: string
  /** Which form the modal opens on; "Get started" opens on sign-up. Defaults to log in. */
  mode?: 'login' | 'signup'
}

export interface Auth {
  user: User | null
  /**
   * The login gate (PRD 7.10). Runs `action` right away when someone is logged in; otherwise opens
   * the login modal and runs `action` once they log in.
   * This is only UX: the API must still refuse every request without a session.
   */
  requireAuth: (action: () => void, prompt?: LoginPrompt) => void
  openLogin: () => void
  signOut: () => void
}

export const AuthContext = createContext<Auth | null>(null)

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
