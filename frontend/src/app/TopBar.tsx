import { Link, NavLink } from 'react-router'
import { MoonIcon, SunIcon, UploadIcon, WyrmMark } from '../components/icons'
import type { Theme } from '../hooks/useTheme'
import { useAuth } from '../features/auth/authContext'
import { AccountMenu } from './AccountMenu'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  /** True while the landing hero's own button is on screen, so there is one primary action in view. */
  ctaHidden: boolean
  onUpload: () => void
}

/**
 * Pinned app bar. Logged out: Home · About · Log in. Logged in: Library · Upload a PDF · account.
 * The current page is marked with a short bookmark ribbon tucked in from the bar's top edge.
 */
export function TopBar({ theme, onToggleTheme, ctaHidden, onUpload }: Props) {
  const dark = theme === 'dark'
  const { user, openLogin } = useAuth()
  return (
    <header className="bar">
      <div className="bar-in">
        <Link className="brand" to="/">
          <WyrmMark />
          <span className="brand-name">Bookwyrm</span>
        </Link>
        <nav aria-label="Main">
          {user ? (
            <NavLink to="/library">Library</NavLink>
          ) : (
            <>
              <NavLink to="/" end>Home</NavLink>
              <NavLink to="/about">About</NavLink>
            </>
          )}
        </nav>
        {user ? (
          <>
            <button
              type="button"
              className={`btn btn-primary bar-cta${ctaHidden ? ' is-hidden' : ''}`}
              aria-label="Upload a PDF"
              aria-hidden={ctaHidden || undefined}
              tabIndex={ctaHidden ? -1 : undefined}
              onClick={onUpload}
            >
              <UploadIcon />
              <span className="label">Upload a PDF</span>
            </button>
            <AccountMenu email={user.email} />
          </>
        ) : (
          <button type="button" className="btn btn-outline bar-login" onClick={openLogin}>Log in</button>
        )}
        <button
          className="icon-btn"
          type="button"
          onClick={onToggleTheme}
          aria-label={dark ? 'Switch to day mode' : 'Switch to night mode'}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  )
}
