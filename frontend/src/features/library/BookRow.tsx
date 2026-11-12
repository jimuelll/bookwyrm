import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../../app/api'
import { isReading, type DocumentStatus, type LibraryDocument } from '../../app/documents'
import type { Quiz } from '../../app/quizzes'
import { CheckIcon } from '../../components/icons'
import { addedLabel, bindingFor } from './books'

/** What each step of reading a PDF is called on the shelf, and how far along it is (of 4). */
const STEPS: Partial<Record<DocumentStatus, { label: string; step: number }>> = {
  queued: { label: 'Waiting to be read', step: 0 },
  extracting: { label: 'Reading the pages', step: 1 },
  chunking: { label: 'Splitting into passages', step: 2 },
  embedding: { label: 'Learning what each passage means', step: 3 },
}

const pages = (n: number | null) => (n === null ? null : `${n} ${n === 1 ? 'page' : 'pages'}`)

interface Props {
  doc: LibraryDocument
  /** this is the file just uploaded again: say it was already here */
  duplicate?: boolean
  /** this book's newest quiz that can be opened (ready, or still being written), if it has one */
  quiz?: Quiz
  onRemove: (id: string) => Promise<void>
}

/**
 * One PDF on the shelf: its cover, title, pages and when it was added, or how far reading it has got.
 * Once it's ready, the links to its quiz and to writing one.
 */
export function BookRow({ doc, duplicate = false, quiz, onRemove }: Props) {
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
            <progress className="shelf-book-progress" max={4} value={step.step} aria-label={`Reading ${doc.title}`} />
            <p className="shelf-book-step" role="status">{step.label}…</p>
          </div>
        )}
        {doc.status === 'failed' && (
          <p className="shelf-book-error">{doc.error ?? 'This PDF couldn’t be read.'}</p>
        )}
        {doc.status === 'ready' && (
          // each link names its book for screen readers, since every row has the same visible words
          <p className="shelf-book-links">
            {quiz?.status === 'ready' && (
              <Link className="text-link" to={`/quizzes/${quiz.id}`} aria-label={`Take the quiz on ${doc.title}`}>
                Take the quiz
              </Link>
            )}
            {quiz?.status === 'generating' && (
              <Link className="text-link" to={`/quizzes/${quiz.id}`} aria-label={`The quiz on ${doc.title} is being written`}>
                Quiz being written…
              </Link>
            )}
            {quiz?.status !== 'generating' && (
              <Link className="text-link" to={`/library/${doc.id}/quiz`} aria-label={`Write a ${quiz ? 'new ' : ''}quiz from ${doc.title}`}>
                {quiz ? 'Write a new quiz' : 'Write a quiz'}
              </Link>
            )}
          </p>
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
