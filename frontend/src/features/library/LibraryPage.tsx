import { usePageTitle, useShell, useStartUpload } from '../../app/shell'
import { useDisplayName } from '../../app/useDisplayName'
import { UploadIcon } from '../../components/icons'
import { ReadingDesk } from './desk/ReadingDesk'
import './library.css'

/**
 * The logged-in home, "Shelf + panel": a working page where the next step is obvious at first glance,
 * set in the hero's world: a paper sheet laid over a dim, lamplit surround (as the hero's book lies over
 * its scene), with the picture framed as a plate.
 *   heading     = "Ex Libris <name>'s library" (the H1) and one line saying where things stand
 *   main column = Your books; for a new reader, one dashed area with the Upload button (the one action)
 *   side panel  = Plate I, the hand-coloured engraving of the wyrm at the inkwell, then "How it works"
 * TODO(library): once uploads exist, a returning reader gets a "Continue where you left off" bar above
 * Your books (one row per PDF), and the panel shows stats instead of the steps; see docs/DESIGN.md.
 */
export function LibraryPage() {
  usePageTitle('Library')
  const { theme } = useShell()
  const name = useDisplayName()
  const startUpload = useStartUpload()

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
          <p className="library-lede">No PDFs yet. Add one to get your first quiz.</p>
        </header>

        <div className="library-grid">
          <section className="shelf" aria-labelledby="books-h">
            <h2 id="books-h">Your books</h2>
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
