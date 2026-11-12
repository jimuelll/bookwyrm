import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, useApi } from '../../app/api'
import { questions, TYPE_LABELS, type Attempt, type Quiz } from '../../app/quizzes'
import { usePageTitle } from '../../app/shell'
import { useResource } from '../../app/useResource'
import { WyrmLoader } from '../../components/inkWyrm/WyrmLoader'
import { QuizJourney } from './QuizJourney'
import './quiz.css'

/**
 * One quiz, before it's taken: being written (the page waits and checks again), failed (why, and a way
 * to ask again), or ready (what's in it, and Begin). Begin starts an attempt and moves to its page.
 */
export function QuizPage() {
  usePageTitle('Quiz')
  const { quizId } = useParams()
  const api = useApi()
  const navigate = useNavigate()
  const { data: quiz, error } = useResource<Quiz>(quizId ? `/quizzes/${quizId}` : null, {
    pollWhile: (q) => q.status === 'generating',
  })
  const [starting, setStarting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Did this visit see the quiz being written? Then its arrival is shown; a quiz opened later from the
  // shelf just shows itself. (Setting state while rendering is React's way to remember something
  // about an earlier render; it re-renders at once, before anything is painted.)
  const [watched, setWatched] = useState(false)
  if (quiz?.status === 'generating' && !watched) setWatched(true)

  async function begin() {
    setStarting(true)
    setProblem(null)
    try {
      const attempt = await api<Attempt>(`/quizzes/${quizId}/attempts`, { method: 'POST' })
      navigate(`/attempts/${attempt.id}`)
    } catch (err) {
      setStarting(false)
      setProblem(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  }

  if (error) {
    return (
      <main className="sheet gate">
        <h1>This quiz couldn’t be opened</h1>
        <p role="alert">{error}</p>
        <Link className="btn btn-outline" to="/library">Back to the library</Link>
      </main>
    )
  }
  if (!quiz) {
    return (
      <main className="sheet" aria-busy="true">
        <WyrmLoader label="Fetching the quiz…" heading />
      </main>
    )
  }
  if (quiz.status === 'generating') {
    return (
      <main className="sheet quiz" aria-busy="true">
        <header className="quiz-head">
          <p className="quiz-kicker">Writing your quiz</p>
          <h1>{quiz.document_title}</h1>
        </header>
        <QuizJourney progress={quiz.progress ?? null} arrived={false} />
        <p className="quiz-lede">
          {quiz.topic ? `On “${quiz.topic}”. ` : ''}Each question is checked against the page it came from, so this can
          take a minute. You can leave this page; the quiz will be on your shelf.
        </p>
      </main>
    )
  }
  if (quiz.status === 'failed') {
    return (
      <main className="sheet gate">
        <h1>This quiz couldn’t be written</h1>
        <p role="alert">{quiz.error ?? 'Something went wrong. Try again.'}</p>
        <Link className="btn btn-primary" to={`/library/${quiz.document_id}/quiz`}>Try again</Link>
        <Link className="text-link" to="/library">Back to the library</Link>
      </main>
    )
  }

  const kinds = quiz.types.map((t) => TYPE_LABELS[t].toLowerCase()).join(', ')
  return (
    <main className="sheet quiz">
      <header className="quiz-head">
        <p className="quiz-kicker">Quiz</p>
        <h1>{quiz.document_title}</h1>
      </header>
      {/* the reader waited here while it was written: let the wyrm finish its road before Begin */}
      {watched && <QuizJourney progress={null} arrived />}
      <p className="quiz-lede">
        {questions(quiz.question_count)} {quiz.topic ? `on “${quiz.topic}” ` : ''}at {quiz.difficulty} difficulty ({kinds}). Nothing is marked until you submit;
        then every answer shows the page it came from.
      </p>
      {quiz.question_count < quiz.count && (
        <p className="quiz-note">
          You asked for {quiz.count}. {quiz.question_count === 1 ? 'Only 1 passed' : `Only ${quiz.question_count} passed`} the
          checks against the PDF, and Bookwyrm doesn’t keep a question it couldn’t verify.
        </p>
      )}
      {problem && <p className="quiz-problem" role="alert">{problem}</p>}
      <div className="quiz-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={begin} disabled={starting}>
          {starting ? 'Starting…' : 'Begin'}
        </button>
        <Link className="text-link" to="/library">Back to the library</Link>
      </div>
    </main>
  )
}
