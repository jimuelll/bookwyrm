import { useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Attempt } from '../../app/quizzes'
import { usePageTitle } from '../../app/shell'
import { useResource } from '../../app/useResource'
import { WyrmLoader } from '../../components/inkWyrm/WyrmLoader'
import { QuizResults } from './QuizResults'
import { TakeQuiz } from './TakeQuiz'
import './quiz.css'

/** One sitting of a quiz: the questions while it's open, the marked results once it's submitted. */
export function AttemptPage() {
  const { attemptId } = useParams()
  // `key` gives each attempt its own fresh state, so "Take it again" never shows the last one's answers
  return <AttemptView key={attemptId} attemptId={attemptId ?? ''} />
}

function AttemptView({ attemptId }: { attemptId: string }) {
  const { data: loaded, error } = useResource<Attempt>(attemptId ? `/attempts/${attemptId}` : null)
  // submitting returns the marked attempt, so we show that instead of fetching it again
  const [marked, setMarked] = useState<Attempt | null>(null)
  const attempt = marked ?? loaded
  usePageTitle(attempt?.finished ? 'Results' : 'Quiz')

  if (error) {
    return (
      <main className="sheet gate">
        <h1>This quiz couldn’t be opened</h1>
        <p role="alert">{error}</p>
        <Link className="btn btn-outline" to="/library">Back to the library</Link>
      </main>
    )
  }
  if (!attempt) {
    return (
      <main className="sheet" aria-busy="true">
        <WyrmLoader label="Laying out the questions…" heading />
      </main>
    )
  }
  return (
    <main className="sheet quiz">
      {attempt.finished ? <QuizResults attempt={attempt} /> : <TakeQuiz attempt={attempt} onMarked={setMarked} />}
    </main>
  )
}
