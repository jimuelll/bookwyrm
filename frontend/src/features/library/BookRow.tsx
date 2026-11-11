import { useState } from 'react'
import { ApiError } from '../../app/api'
import { isReading, type DocumentStatus, type LibraryDocument } from '../../app/documents'
import { CheckIcon } from '../../components/icons'
import { addedLabel, bindingFor } from './books'

/** What each step of reading a PDF is called on the shelf, and how far along it is (of 3). */
const STEPS: Partial<Record<DocumentStatus, { label: string; step: number }>> = {
  queued: { label: 'Waiting to be read', step: 0 },
  extracting: { label: 'Reading the pages', step: 1 },
  chunking: { label: 'Splitting into passages', step: 2 },
}

const pages = (n: number | null) => (n === null ? null : `${n} ${n === 1 ? 'page' : 'pages'}`)

interface Props {
  doc: LibraryDocument
  /** this is the file just uploaded again: say it was already here */
  duplicate?: boolean
  onRemove: (id: string) => Promise<void>
}

/** One PDF on the shelf: its cover, title, pages and when it was added, or how far reading it has got. */
export function BookRow({ doc, duplicate = false, onRemove }: Props) {
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const step = STEPS[doc.status]
  const meta = [pages(doc.page_count), addedLabel(doc.created_at)].filter(Boolean).join(' · ')

  async function remove() {
    setRemoving(true)
    setRemoveError(null)
    try {
      await onRemove(doc.id)
    } catch (e) {
      setRemoving(false)
      setRemoveError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
    }
  }

  return (
    <li className={`shelf-book is-${doc.status}`}>
      <span className={`cover ${bindingFor(doc.id)}`} aria-hidden="true" />
      <div className="shelf-book-text">
        <h3 className="shelf-book-title">{doc.title}</h3>
        <p className="shelf-book-meta">{meta}</p>
        {duplicate && <p className="shelf-book-note" role="status">Already on your shelf</p>}
        {isReading(doc.status) && step && (
          <div className="shelf-book-reading">
            <progress className="shelf-book-progress" max={3} value={step.step} aria-label={`Reading ${doc.title}`} />
            <p className="shelf-book-step" role="status">{step.label}…</p>
          </div>
        )}
        {doc.status === 'failed' && (
          <p className="shelf-book-error">{doc.error ?? 'This PDF couldn’t be read.'}</p>
        )}
        {removeError && <p className="shelf-book-error" role="alert">{removeError}</p>}
      </div>
      {doc.status === 'ready' && (
        <span className="shelf-book-state"><CheckIcon />Ready</span>
      )}
      {doc.status === 'failed' && (
        <button type="button" className="shelf-book-remove" onClick={remove} disabled={removing} aria-label={`Remove ${doc.title}`}>
          {removing ? 'Removing…' : 'Remove'}
        </button>
      )}
    </li>
  )
}
