import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { AuthContext, type Auth, type LoginPrompt, type User } from './authContext'
import { LoginModal } from './LoginModal'

/** Holds who is logged in and owns the one login modal, so any screen can gate an action behind it. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [modal, setModal] = useState<{ open: boolean } & LoginPrompt>({ open: false })
  // the gated action waiting for a login (e.g. "upload"); dropped if the modal is dismissed
  const pending = useRef<(() => void) | null>(null)

  const requireAuth = useCallback<Auth['requireAuth']>(
    (action, prompt) => {
      if (user) return action()
      pending.current = action
      setModal({ open: true, ...prompt })
    },
    [user],
  )

  const value = useMemo<Auth>(
    () => ({
      user,
      requireAuth,
      openLogin: () => {
        pending.current = null
        setModal({ open: true })
      },
      signOut: () => setUser(null),
    }),
    [user, requireAuth],
  )

  function handleSignedIn(signedIn: User) {
    setUser(signedIn)
    setModal({ open: false })
    const action = pending.current
    pending.current = null
    action?.()
  }

  function handleClose() {
    pending.current = null
    setModal({ open: false })
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      <LoginModal open={modal.open} reason={modal.reason} initialMode={modal.mode} onClose={handleClose} onSignedIn={handleSignedIn} />
    </AuthContext.Provider>
  )
}
