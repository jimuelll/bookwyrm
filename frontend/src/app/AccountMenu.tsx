import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../features/auth/authContext'

/** The logged-in reader's initial; opens a small paper card with who is logged in and Log out. */
export function AccountMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const { signOut } = useAuth()
  const navigate = useNavigate()

  // close on a click anywhere else, or on Esc (then focus goes back to the button)
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function logOut() {
    setOpen(false)
    signOut()
    navigate('/')
  }

  return (
    <div className="account" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="icon-btn account-btn"
        aria-label="Account"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
      </button>
      {open && (
        <div className="account-card" id={id}>
          <p className="account-who">
            <span>Logged in as</span>
            <strong>{email}</strong>
          </p>
          <button type="button" className="btn btn-outline" onClick={logOut}>Log out</button>
        </div>
      )}
    </div>
  )
}
