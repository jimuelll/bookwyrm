import { createContext, useContext } from 'react'

export interface User {
  email: string
}

export interface Auth {
  user: User | null
  /**
   * The login gate (PRD 7.10). Runs `action` right away when someone is logged in; otherwise opens
   * the login modal and runs `action` once they log in. `reason` is shown in the modal ("You need an account to upload a PDF.").
   * This is only UX: the API must still refuse every request without a session.
   */
  requireAuth: (action: () => void, reason?: string) => void
  openLogin: () => void
  signOut: () => void
}

export const AuthContext = createContext<Auth | null>(null)

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
