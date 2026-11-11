import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useTheme } from '../hooks/useTheme'
import { useStartUpload, type Shell } from './shell'
import { TopBar } from './TopBar'
import './shell.css'

/** Every page: the pinned bar, then the page itself. Owns the theme so it survives page changes. */
export function AppLayout() {
  const { theme, toggle } = useTheme()
  const startUpload = useStartUpload()
  const { pathname, hash, key } = useLocation()

  // A client-side route change keeps the old scroll position, so reset it like a real page load,
  // or jump to the #section the link named (e.g. "How it works" from the About page).
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.()
    else window.scrollTo(0, 0)
  }, [pathname, hash, key])

  const shell: Shell = { theme }
  return (
    <>
      <TopBar theme={theme} onToggleTheme={toggle} onUpload={() => startUpload()} />
      <Outlet context={shell} />
    </>
  )
}
