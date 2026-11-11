import { useCallback, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import type { Theme } from '../hooks/useTheme'
import { useAuth, type LoginPrompt } from '../features/auth/authContext'

/** What the layout shares with every page rendered in its <Outlet>. */
export interface Shell {
  theme: Theme
  /** The landing hero reports whether its own call-to-action is on screen, so the bar can hide its copy. */
  setHeroCtaVisible: (visible: boolean) => void
}

export function useShell() {
  return useOutletContext<Shell>()
}

/**
 * Start an upload. Logged out, this opens the login modal first (PRD 7.10) and continues after login.
 * TODO(upload): open the upload + quiz configuration flow; for now it lands on the Library.
 */
export function useStartUpload() {
  const { requireAuth } = useAuth()
  const navigate = useNavigate()
  return useCallback(
    (prompt: LoginPrompt = { reason: 'You need an account to upload a PDF.' }) =>
      requireAuth(() => navigate('/library'), { next: '/library', ...prompt }),
    [requireAuth, navigate],
  )
}

/** Sets the browser tab title for a page, so each route is distinguishable in tabs, history and screen readers. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Bookwyrm`
  }, [title])
}
