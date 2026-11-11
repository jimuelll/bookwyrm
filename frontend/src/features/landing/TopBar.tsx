import { MoonIcon, SunIcon, UploadIcon, WyrmMark } from '../../components/icons'
import type { Theme } from '../../hooks/useTheme'
import { useAuth } from '../auth/authContext'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  /** False while the hero's own Upload button is on screen, so there is one primary action in view. */
  showCta: boolean
  onUpload: () => void
}

/** Pinned app bar: always reachable brand, nav, theme switch and the primary action. */
export function TopBar({ theme, onToggleTheme, showCta, onUpload }: Props) {
  const dark = theme === 'dark'
  const { user, openLogin, signOut } = useAuth()
  return (
    <header className="bar">
      <div className="bar-in">
        <a className="brand" href="/">
          <WyrmMark />
          Bookwyrm
        </a>
        <nav aria-label="Main">
          <a className="hide-sm" href="#how">How it works</a>
          <a className="hide-md" href="#">Evaluation</a>
          {user ? (
            <button type="button" className="nav-btn" title={`Logged in as ${user.email}`} onClick={signOut}>
              Log out
            </button>
          ) : (
            <button type="button" className="nav-btn" onClick={openLogin}>Log in</button>
          )}
        </nav>
        <button
          className="icon-btn"
          type="button"
          onClick={onToggleTheme}
          aria-label={dark ? 'Switch to day mode' : 'Switch to night mode'}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          className={`btn btn-primary bar-cta${showCta ? '' : ' is-hidden'}`}
          aria-label="Upload a PDF"
          aria-hidden={showCta ? undefined : true}
          tabIndex={showCta ? undefined : -1}
          onClick={onUpload}
        >
          <UploadIcon />
          <span className="label">Upload a PDF</span>
        </button>
      </div>
    </header>
  )
}
