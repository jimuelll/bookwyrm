import { useCallback, useEffect } from 'react'
import { useOutletContext } from 'react-router'
import type { Theme } from '../hooks/useTheme'
import { useAuth, type LoginPrompt } from '../features/auth/authContext'
import { useUploads } from './upload/uploadContext'

/** What the layout shares with every page rendered in its <Outlet>. */
export interface Shell {
  theme: Theme
}

export function useShell() {
  return useOutletContext<Shell>()
}

/**
 * Start an upload: open the upload dialog (app/upload). Logged out, this opens the login modal first
 * (PRD 7.10) and continues to the dialog after login; after a Google redirect, which reloads the page,
 * the reader lands on the Library instead (`next`), where Upload is one click away.
 */
export function useStartUpload() {
  const { requireAuth } = useAuth()
  const { open } = useUploads()
  return useCallback(
    (prompt: LoginPrompt = { reason: 'You need an account to upload a PDF.' }) =>
      requireAuth(open, { next: '/library', ...prompt }),
    [requireAuth, open],
  )
}

/** Sets the browser tab title for a page, so each route is distinguishable in tabs, history and screen readers. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Bookwyrm`
  }, [title])
}
