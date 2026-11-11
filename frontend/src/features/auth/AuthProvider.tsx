import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AuthBackend } from './authBackend'
import { AuthContext, type Auth, type LoginPrompt, type User } from './authContext'
import { LoginModal } from './LoginModal'
import { supabaseBackend } from './supabaseBackend'

/** Holds who is logged in and owns the one login modal, so any screen can gate an action behind it. */
export function AuthProvider({ children, backend = supabaseBackend }: { children: ReactNode; backend?: AuthBackend }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [modal, setModal] = useState<{ open: boolean } & LoginPrompt>({ open: false })
  // the gated action waiting for a login (e.g. "upload"); dropped if the modal is dismissed
  const pending = useRef<(() => void) | null>(null)

  // Restore a saved session, then follow every change (log in/out here, in another tab, token refresh).
  useEffect(() => {
    let alive = true
    backend
      .getUser()
      .then((u) => alive && setUser(u))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setReady(true))
    const unsubscribe = backend.onChange(setUser)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [backend])

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
      ready,
      backend,
      requireAuth,
      openLogin: (prompt) => {
        pending.current = null
        setModal({ open: true, ...prompt })
      },
      signOut: async () => {
        await backend.signOut()
        setUser(null)
      },
    }),
    [user, ready, backend, requireAuth],
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
      <LoginModal
        open={modal.open}
        reason={modal.reason}
        initialMode={modal.mode}
        next={modal.next}
        backend={backend}
        onClose={handleClose}
        onSignedIn={handleSignedIn}
      />
    </AuthContext.Provider>
  )
}
