import { usePageTitle, useShell, useStartUpload } from '../../app/shell'
import { useDisplayName } from '../../app/useDisplayName'
import { UploadIcon, WyrmMark } from '../../components/icons'
import stacksDay from '../../assets/stacks-day.webp'
import stacksNight from '../../assets/stacks-night.webp'
import './library.css'

/**
 * The logged-in home, set as a book like the landing hero but quieter (no live 3D):
 *   left page  = the inside cover, with an Ex Libris bookplate bearing the reader's name
 *   right page = a framed still painting of the stacks, with a card saying what to do next
 * Below it, the catalogue: one index card per PDF.
 * TODO(library): real PDFs, counts and "continue where you left off" once uploads exist.
 */
export function LibraryPage() {
  usePageTitle('Library')
  const { theme } = useShell()
  const name = useDisplayName()
  const startUpload = useStartUpload()
  const dark = theme === 'dark'

  return (
    <main className="library">
      <section className="lib-book">
        <div className="lib-page lib-page-l">
          {/* a bookplate is pasted inside a book's cover; "Ex Libris" means "from the library of" */}
          <div className="ex-libris">
            {/* the wyrm as the printer's mark, where an old bookplate has its device */}
            <WyrmMark className="ex-libris-mark" />
            <h1>
              <span className="ex-libris-label">Ex Libris</span>{' '}
              {/* the space keeps screen readers from reading "Ex LibrisAna" as one word */}
              <span className="ex-libris-name">{name}</span>
            </h1>
            <span className="ex-libris-rule" aria-hidden="true" />
            <p className="ex-libris-facts">An empty shelf, for now.</p>
          </div>
          <span className="lib-folio" aria-hidden="true">— i —</span>
        </div>

        <div className="lib-page lib-page-r">
          <span className="lib-running" aria-hidden="true">The Reading Room</span>
          <div className="lib-window">
            <figure className="lib-plate">
              <img
                src={dark ? stacksNight : stacksDay}
                alt=""
                width={1203}
                height={1208}
                decoding="async"
              />
            </figure>
            <div className="lib-next">
              <WyrmMark />
              <div>
                <h2>Nothing on your shelves yet</h2>
                <p>Upload a PDF and Bookwyrm will write your first quiz from it, with the page for every answer.</p>
                <button type="button" className="lib-next-link" onClick={() => startUpload()}>
                  <UploadIcon />
                  Upload your first PDF
                </button>
              </div>
            </div>
          </div>
          <p className="lib-caption">Your stacks by {dark ? 'lamplight' : 'daylight'}.</p>
        </div>
      </section>

      <section className="catalogue" aria-labelledby="catalogue-h">
        <h2 id="catalogue-h">Catalogue</h2>
        <p className="catalogue-lede">Every PDF you add gets a card here.</p>
        <ul className="catalogue-cards">
          {/* an empty, unfilled card shows what a filed one will hold */}
          <li className="cat-card is-blank">
            <span className="cat-card-title">Your first PDF</span>
            <span className="cat-card-line">Title, pages and topics</span>
            <span className="cat-card-line">Passing confidence and quizzes taken</span>
            <span className="cat-card-hole" aria-hidden="true" />
          </li>
        </ul>
      </section>
    </main>
  )
}
