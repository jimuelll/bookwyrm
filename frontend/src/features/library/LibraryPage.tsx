import type { Quiz } from '../../app/quizzes'
import { usePageTitle, useShell, useStartUpload } from '../../app/shell'
import { useResource } from '../../app/useResource'
import { useDisplayName } from '../../app/useDisplayName'
import { useUploads } from '../../app/upload/uploadContext'
import { UploadIcon } from '../../components/icons'
import { BookRow } from './BookRow'
import { ReadingDesk } from './desk/ReadingDesk'
import { useDocuments } from './useDocuments'
import './library.css'

/**
 * The logged-in home, "Shelf + panel": a working page where the next step is obvious at first glance,
 * set in the hero's world: a paper sheet laid over a dim, lamplit surround (as the hero's book lies over
 * its scene), with the picture framed as a plate.
 *   heading     = "Ex Libris <name>'s library" (the H1) and one line saying where things stand
 *   main column = Your books: one row per PDF (cover, title, pages, and its status while it's being read),
 *                 then "Add a PDF"; for a new reader, one dashed area with the Upload button (the one action)
 *   side panel  = Plate I, the hand-coloured engraving of the wyrm at the inkwell, then "How it works"
 * A ready book's row links to its latest quiz and to writing a new one (features/quiz).
 * TODO(library): once stats exist, a "Continue where you left off" bar above Your books, confidence on
 * each row, and stats in the panel instead of the steps; see docs/DESIGN.md.
 */
export function LibraryPage() {
  usePageTitle('Library')
  const { theme } = useShell()
  const name = useDisplayName()
  const startUpload = useStartUpload()
  const { last } = useUploads()
  const { docs, error, retry, remove } = useDocuments()
  // If the quizzes can't be fetched the shelf still works: rows just offer "Write a quiz".
  // (Checked to be a list, so an unexpected reply can't take the whole page down with it.)
  const { data } = useResource<Quiz[]>('/quizzes', {
    pollWhile: (list) => Array.isArray(list) && list.some((q) => q.status === 'generating'),
  })
  const quizzes = Array.isArray(data) ? data : []

  const count = docs?.length ?? 0
  const lede =
    docs === null ? (error ? 'Your books couldn’t be loaded.' : ' ') // keep the line's height while loading
    : count === 0 ? 'No PDFs yet. Add one to get your first quiz.'
    : `${count} ${count === 1 ? 'PDF' : 'PDFs'} on your shelf.`

  return (
    <main className="library-surround">
      <div className="library">
        <header className="library-head">
          <h1>
            {/* the space keeps screen readers from running "Ex Libris" and the name together */}
            <span className="library-kicker">Ex Libris</span>{' '}
            {name ? (
              <span className="library-title">{name}’s library</span>
            ) : (
              // still loading on a first visit: an unfilled bookplate's blank name line, not a guess
              <span className="library-title is-blank" aria-hidden="true" />
            )}
          </h1>
          <p className="library-lede">{lede}</p>
        </header>

        <div className="library-grid">
          <section className="shelf" aria-labelledby="books-h" aria-busy={docs === null && !error}>
            <h2 id="books-h">Your books</h2>
            {docs === null ? (
              error ? (
                <div className="shelf-problem">
                  <p className="shelf-error" role="alert">{error}</p>
                  <button type="button" className="btn btn-outline" onClick={retry}>Try again</button>
                </div>
              ) : null // loading: usually a blink, so nothing rather than a flash of a loader
            ) : count === 0 ? (
              <div className="shelf-empty">
                {/* three faint book covers in the hero's leathers: where your PDFs will be shelved */}
                <div className="shelf-ghosts" aria-hidden="true">
                  <span className="cover is-oxblood" />
                  <span className="cover is-green" />
                  <span className="cover is-navy" />
                </div>
                <p className="shelf-empty-title">Your first book goes here</p>
                <p className="shelf-empty-text">Upload a PDF and Bookwyrm writes a quiz from it, with the page for every answer.</p>
                <button type="button" className="btn btn-primary btn-lg" onClick={() => startUpload()}>
                  <UploadIcon />
                  Upload your first PDF
                </button>
              </div>
            ) : (
              <ul className="shelf-books">
                {docs.map((doc) => (
                  <BookRow
                    key={doc.id}
                    doc={doc}
                    duplicate={last?.duplicate === true && last.id === doc.id}
                    // newest first, so the first match is this book's latest quiz that can be opened
                    quiz={quizzes.find((q) => q.document_id === doc.id && q.status !== 'failed')}
                    onRemove={remove}
                  />
                ))}
                <li className="shelf-book shelf-book-add">
                  <button type="button" onClick={() => startUpload()}>
                    <span className="cover is-ghost" aria-hidden="true" />
                    <span className="shelf-book-text">
                      <span className="shelf-book-title">Add a PDF</span>
                      <span className="shelf-book-meta">Notes, a chapter, a paper</span>
                    </span>
                    <UploadIcon className="shelf-book-add-icon" />
                  </button>
                </li>
              </ul>
            )}
          </section>

          <aside className="side-panel" aria-labelledby="how-h">
            {/* a framed plate, as the hero frames its scene; decorative, so the caption is hidden with it */}
            <figure className="plate" aria-hidden="true">
              <ReadingDesk scene="inkwell" className="plate-art" />
              <figcaption>
                <span className="plate-no">Plate I</span>
                <span className="plate-cap">The wyrm at the inkwell, by {theme === 'dark' ? 'lamplight' : 'daylight'}.</span>
              </figcaption>
            </figure>
            <h2 id="how-h">How it works</h2>
            <ol className="how-steps">
              <li><strong>Upload a PDF</strong>Lecture notes, a textbook chapter, a paper.</li>
              <li><strong>Take the quiz</strong>Bookwyrm writes the questions from your PDF.</li>
              <li><strong>Check the page</strong>Every answer shows the page it came from.</li>
            </ol>
          </aside>
        </div>
      </div>
    </main>
  )
}
