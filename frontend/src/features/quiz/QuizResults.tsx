import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, useApi } from '../../app/api'
import type { Attempt, AttemptQuestion } from '../../app/quizzes'
import { BookmarkIcon, CheckIcon, CrossIcon } from '../../components/icons'
import { missedTopics } from './missedTopics'
import { useTopicQuiz } from './useTopicQuiz'

/** What the reader answered, in words: the option's text for multiple choice, else what they typed. */
function shown(question: AttemptQuestion, response: string | null) {
  if (response === null) return null
  return question.options?.find((o) => o.id === response)?.text ?? response
}

const pagesLabel = (pages: number[]) => `${pages.length === 1 ? 'p.' : 'pp.'} ${pages.join(', ')}`

/**
 * The marked attempt: the score, then every question with the reader's answer, the right one, why, and
 * the sentence and page that prove it. The citation is always open here; it is the point of the product.
 */
export function QuizResults({ attempt }: { attempt: Attempt }) {
  const api = useApi()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)
  const topicQuiz = useTopicQuiz(attempt.document_id)
  const reviewing = topicQuiz.starting
  const [problem, setProblem] = useState<string | null>(null)
  const missed = missedTopics(attempt.questions)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // arriving from Submit: start at the top, on the score
  useEffect(() => {
    window.scrollTo(0, 0)
    headingRef.current?.focus()
  }, [])

  async function again() {
    setStarting(true)
    setProblem(null)
    try {
      // a new attempt of the same questions; the server shuffles them afresh
      const next = await api<Attempt>(`/quizzes/${attempt.quiz_id}/attempts`, { method: 'POST' })
      navigate(`/attempts/${next.id}`)
    } catch (err) {
      setStarting(false)
      setProblem(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  }

  return (
    <>
      <header className="quiz-head">
        <p className="quiz-kicker">Results · {attempt.document_title}</p>
        <h1 ref={headingRef} tabIndex={-1}>
          {attempt.score} of {attempt.total} correct
        </h1>
      </header>

      <ol className="quiz-results">
        {attempt.questions.map((q, i) => {
          const r = q.result
          if (!r) return null
          const yours = shown(q, r.response)
          const verdict = r.is_correct ? 'Correct' : yours === null ? 'Not answered' : 'Not quite'
          return (
            <li key={q.id} className="quiz-result">
              <p className="quiz-result-head">
                <span className="quiz-result-n">Question {i + 1}</span>
                <span className={`quiz-verdict ${r.is_correct ? 'is-right' : 'is-wrong'}`}>
                  {r.is_correct ? <CheckIcon /> : <CrossIcon />}
                  {verdict}
                </span>
              </p>
              <h2 className="quiz-result-q">{q.prompt}</h2>
              <dl className="quiz-result-answers">
                {!r.is_correct && yours !== null && (
                  <div>
                    <dt>Your answer</dt>
                    <dd className="is-wrong">{yours}</dd>
                  </div>
                )}
                <div>
                  <dt>{r.is_correct ? 'Your answer' : 'Answer'}</dt>
                  <dd>{r.answer}</dd>
                </div>
              </dl>
              <p className="quiz-result-why">{r.explanation}</p>
              <blockquote className="quiz-passage">
                <p><mark>{r.evidence}</mark></p>
                <footer>
                  <BookmarkIcon />
                  {attempt.document_title}, p. {r.page}
                </footer>
              </blockquote>
            </li>
          )
        })}
      </ol>

      {missed.length > 0 && (
        <section className="quiz-review" aria-labelledby="quiz-review-title">
          <h2 id="quiz-review-title">What to study</h2>
          <p>A short quiz on just that part of the PDF, written from the pages that cover it.</p>
          <ul>
            {missed.map((m) => (
              <li key={m.topic}>
                <span className="quiz-review-topic">
                  {m.topic} <span className="quiz-review-pages">{pagesLabel(m.pages)}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => topicQuiz.start(m.topic)}
                  disabled={starting || reviewing !== null}
                  aria-label={`Quiz me on ${m.topic}`}
                >
                  {reviewing === m.topic ? 'Starting…' : 'Quiz me on this'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(problem ?? topicQuiz.problem) && (
        <p className="quiz-problem" role="alert">{problem ?? topicQuiz.problem}</p>
      )}
      <div className="quiz-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={again} disabled={starting || reviewing !== null}>
          {starting ? 'Starting…' : 'Take it again'}
        </button>
        <Link className="text-link" to={`/library/${attempt.document_id}/quiz`}>Write a new quiz</Link>
        <Link className="text-link" to="/library">Back to the library</Link>
      </div>
    </>
  )
}
