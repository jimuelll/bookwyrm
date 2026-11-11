import { usePageTitle } from '../../app/shell'
import { WyrmMark } from '../../components/icons'
import './library.css'

/**
 * Placeholder until uploads exist. TODO(library): list the reader's PDFs with their stats (PRD 7.6),
 * a "Shared with me" section and History.
 */
export function LibraryPage() {
  usePageTitle('Library')
  return (
    <main className="sheet library">
      <h1>Your library</h1>
      <div className="library-empty">
        <WyrmMark />
        <h2>No PDFs yet</h2>
        <p>Your PDFs will appear here, each with its quizzes and stats.</p>
      </div>
    </main>
  )
}
