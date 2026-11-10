import { MoonIcon, SunIcon, UploadIcon, WyrmMark } from '../../components/icons'
import type { Theme } from '../../hooks/useTheme'

interface Props {
  theme: Theme
  onToggleTheme: () => void
}

/** Pinned app bar: always reachable brand, nav, theme switch and the primary action. */
export function TopBar({ theme, onToggleTheme }: Props) {
  const dark = theme === 'dark'
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
          <a href="#">Log in</a>
        </nav>
        <button
          className="icon-btn"
          type="button"
          onClick={onToggleTheme}
          aria-label={dark ? 'Switch to day mode' : 'Switch to night mode'}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
        <a className="btn btn-primary" href="#" aria-label="Upload a PDF">
          <UploadIcon />
          <span className="label">Upload a PDF</span>
        </a>
      </div>
    </header>
  )
}
