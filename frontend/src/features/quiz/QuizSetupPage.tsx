import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, useApi } from '../../app/api'
import type { LibraryDocument } from '../../app/documents'
import { questions, TYPE_LABELS, type Difficulty, type QuestionType, type Quiz, type QuizScope } from '../../app/quizzes'
import { usePageTitle } from '../../app/shell'
import { useResource } from '../../app/useResource'
import { WyrmLoader } from '../../components/inkWyrm/WyrmLoader'
import { useDebounced } from '../../hooks/useDebounced'
import './quiz.css'

const PRESETS = [3, 5, 10, 15, 20]
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']
const TYPES = Object.keys(TYPE_LABELS) as QuestionType[]
const TOPIC_MAX = 80

const pagesLabel = (s: QuizScope) => (s.page_first === s.page_last ? `p. ${s.page_first}` : `pp. ${s.page_first}–${s.page_last}`)

/**
 * Ask for a quiz from one PDF: the whole of it or one topic, how many questions, how hard, which kinds.
 * The number of questions follows the material: the server measures the chosen scope (GET quiz-scope,
 * no model involved) and answers with a suggestion and a ceiling, which shape the choices offered here.
 */
export function QuizSetupPage() {
  usePageTitle('New quiz')
  const { documentId } = useParams()
  const api = useApi()
  const navigate = useNavigate()
  const { data: doc, error } = useResource<LibraryDocument>(documentId ? `/documents/${documentId}` : null)

  const [focused, setFocused] = useState(false) // false: the whole PDF; true: one topic
  const [topicText, setTopicText] = useState('')
  const [count, setCount] = useState<number | null>(null) // null: go with the server's suggestion
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [types, setTypes] = useState<QuestionType[]>(['mcq'])
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // measure the scope once the reader pauses typing, not on every key
  const topic = useDebounced(topicText.trim(), 350)
  const needsTopic = focused && topic === ''
  const scopePath = !documentId || needsTopic ? null
    : `/documents/${documentId}/quiz-scope${focused ? `?topic=${encodeURIComponent(topic)}` : ''}`
  const { data: scope, error: scopeError } = useResource<QuizScope>(scopePath)
  const settling = focused && topicText.trim() !== topic // typed, but not measured yet

  const empty = scope !== null && scope.passages === 0
  const max = scope?.max_count ?? 0
  // what was picked earlier may not fit a smaller scope: fall back to what fits
  const chosen = scope && !empty ? Math.min(count ?? scope.suggested_count, max) : null
  const presets = scope && !empty
    ? [...new Set([...PRESETS.filter((n) => n <= max), scope.suggested_count])].sort((a, b) => a - b)
    : []

  function toggleType(type: QuestionType) {
    setTypes((list) => (list.includes(type) ? list.filter((t) => t !== type) : [...list, type]))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (chosen === null) return
    setSending(true)
    setProblem(null)
    try {
      // The server answers at once ("202 Accepted") with a quiz that is still being written;
      // the quiz page then watches it until it's ready.
      const body = { count: chosen, difficulty, types, ...(focused ? { topic } : {}) }
      const quiz = await api<Quiz>(`/documents/${documentId}/quizzes`, { method: 'POST', body: JSON.stringify(body) })
      navigate(`/quizzes/${quiz.id}`)
    } catch (err) {
      setSending(false)
      setProblem(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  }

  if (error) {
    return (
      <main className="sheet gate">
        <h1>This PDF couldn’t be opened</h1>
        <p role="alert">{error}</p>
        <Link className="btn btn-outline" to="/library">Back to the library</Link>
      </main>
    )
  }
  if (!doc) {
    return (
      <main className="sheet" aria-busy="true">
        <WyrmLoader label="Fetching the book…" heading />
      </main>
    )
  }

  const notReady = doc.status !== 'ready'
  const blocked = sending || notReady || types.length === 0 || chosen === null || settling
  return (
    <main className="sheet quiz">
      <header className="quiz-head">
        <p className="quiz-kicker">New quiz</p>
        <h1>{doc.title}</h1>
      </header>
      <p className="quiz-lede">
        Bookwyrm writes the questions from this PDF and checks each one against the page it came from.
      </p>

      <form className="quiz-form" onSubmit={submit}>
        <fieldset className="quiz-field">
          <legend>What to cover</legend>
          <div className="quiz-choices">
            <label className="quiz-choice">
              <input type="radio" name="scope" checked={!focused} onChange={() => setFocused(false)} />
              <span>The whole PDF</span>
            </label>
            <label className="quiz-choice">
              <input type="radio" name="scope" checked={focused} onChange={() => setFocused(true)} />
              <span>One topic</span>
            </label>
          </div>
          {focused && (
            <div className="quiz-topic">
              <label htmlFor="quiz-topic">Topic</label>
              <input
                id="quiz-topic"
                type="text"
                value={topicText}
                onChange={(e) => setTopicText(e.target.value)}
                maxLength={TOPIC_MAX}
                placeholder="e.g. osmosis"
                autoComplete="off"
                autoFocus
                aria-describedby="quiz-topic-found"
              />
              {/* announced politely, so a screen reader hears what the typing found */}
              <p id="quiz-topic-found" className={`quiz-hint${empty ? ' is-none' : ''}`} role="status">
                {needsTopic || settling ? 'A word or phrase that appears in the PDF.'
                  : scopeError ? scopeError
                  : !scope ? 'Looking through the PDF…'
                  : empty ? `Nothing in this PDF mentions “${scope.topic}”. Try a word or phrase from the text.`
                  : `Found in ${scope.passages} ${scope.passages === 1 ? 'passage' : 'passages'}, ${pagesLabel(scope)}.`}
              </p>
            </div>
          )}
        </fieldset>

        <fieldset className="quiz-field">
          <legend>How many questions</legend>
          {chosen === null ? (
            <p className="quiz-hint">
              {empty ? 'There is nothing in the PDF to ask about on that topic.'
                : focused ? 'Choose a topic first: the number depends on how much the PDF says about it.'
                : scopeError ?? 'Measuring the PDF…'}
            </p>
          ) : (
            <>
              <div className="quiz-choices">
                {presets.map((n) => (
                  <label key={n} className="quiz-choice">
                    <input type="radio" name="count" checked={chosen === n} onChange={() => setCount(n)} aria-label={questions(n)} />
                    <span>{n}</span>
                  </label>
                ))}
                <label className="quiz-other">
                  <span>or</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={max}
                    value={presets.includes(chosen) ? '' : chosen}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10)
                      setCount(Number.isNaN(n) ? null : Math.max(1, Math.min(max, n)))
                    }}
                    aria-label={`Another number of questions, up to ${max}`}
                  />
                </label>
              </div>
              <p className="quiz-hint">
                {scope!.suggested_count} suits {focused ? 'what the PDF says about this topic' : 'a PDF of this length'}; there is
                enough material for up to {max}.
              </p>
            </>
          )}
        </fieldset>

        <fieldset className="quiz-field">
          <legend>How hard</legend>
          <div className="quiz-choices">
            {DIFFICULTIES.map((d) => (
              <label key={d} className="quiz-choice">
                <input type="radio" name="difficulty" checked={difficulty === d} onChange={() => setDifficulty(d)} />
                <span>{d[0].toUpperCase() + d.slice(1)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="quiz-field">
          <legend>Kinds of question</legend>
          <div className="quiz-choices">
            {TYPES.map((t) => (
              <label key={t} className="quiz-choice">
                <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} />
                <span>{TYPE_LABELS[t]}</span>
              </label>
            ))}
          </div>
          {/* the boxes look like the single-choice ones above, so say that these can be combined */}
          <p className="quiz-hint">Choose one or more.</p>
        </fieldset>

        {notReady && <p className="quiz-problem" role="alert">This PDF isn’t ready to be quizzed yet.</p>}
        {problem && <p className="quiz-problem" role="alert">{problem}</p>}
        <div className="quiz-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={blocked}>
            {sending ? 'Starting…' : 'Write my quiz'}
          </button>
          <Link className="text-link" to="/library">Back to the library</Link>
        </div>
      </form>
    </main>
  )
}
