import { useEffect, useRef, useState } from 'react'
import { ApiError, useApi } from '../../app/api'
import type { Attempt, AttemptQuestion, QuizOption } from '../../app/quizzes'
import { ArrowRightIcon } from '../../components/icons'

const LETTERS = ['A', 'B', 'C', 'D']
const TRUE_FALSE: QuizOption[] = [
  { id: 'True', text: 'True' },
  { id: 'False', text: 'False' },
]

interface Props {
  attempt: Attempt
  /** Called with the marked attempt the server sends back after Submit */
  onMarked: (attempt: Attempt) => void
}

/**
 * The questions, one at a time. Answers are kept here, in the page, until Submit sends them all at once:
 * the server marks them (it is the only place the right answers exist) and replies with the results.
 */
export function TakeQuiz({ attempt, onMarked }: Props) {
  const api = useApi()
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const promptRef = useRef<HTMLParagraphElement>(null)

  const question = attempt.questions[index]
  const last = index === attempt.total - 1
  const answered = (q: AttemptQuestion) => (answers[q.id] ?? '').trim() !== ''
  const unanswered = attempt.questions.filter((q) => !answered(q)).length

  // moving to another question: put keyboard and screen-reader users on its text
  const first = useRef(true)
  useEffect(() => {
    if (first.current) first.current = false
    else promptRef.current?.focus()
  }, [index])

  const answer = (value: string) => setAnswers((a) => ({ ...a, [question.id]: value }))

  async function submit() {
    setSending(true)
    setProblem(null)
    // a question with no answer is simply left out; the server counts it as wrong
    const given = Object.fromEntries(attempt.questions.filter(answered).map((q) => [q.id, answers[q.id].trim()]))
    try {
      onMarked(await api<Attempt>(`/attempts/${attempt.id}/submit`, { method: 'POST', body: JSON.stringify({ answers: given }) }))
    } catch (err) {
      setSending(false)
      setProblem(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  }

  const options = question.type === 'true_false' ? TRUE_FALSE : question.options
  return (
    <>
      <header className="quiz-head">
        <p className="quiz-kicker">{attempt.document_title}</p>
        <h1 className="quiz-count">
          Question {index + 1} <span>of {attempt.total}</span>
        </h1>
        <progress className="quiz-progress" max={attempt.total} value={index + 1} aria-hidden="true" />
      </header>

      {/* Enter in the text box moves on, like the Next button; it never submits the whole quiz by accident */}
      <form
        className="quiz-question"
        onSubmit={(e) => {
          e.preventDefault()
          if (!last) setIndex(index + 1)
        }}
      >
        <p className="quiz-q" id="quiz-q" ref={promptRef} tabIndex={-1}>{question.prompt}</p>

        {options ? (
          <fieldset className="quiz-opts" aria-labelledby="quiz-q">
            {options.map((option, i) => (
              <label key={option.id} className="quiz-opt">
                {/* a real radio button, hidden but still focusable: arrow keys move between options for free */}
                <input
                  type="radio"
                  className="sr-only"
                  name={question.id}
                  checked={answers[question.id] === option.id}
                  onChange={() => answer(option.id)}
                />
                <span className="quiz-opt-l" aria-hidden="true">{question.type === 'true_false' ? option.text[0] : LETTERS[i]}</span>
                <span className="quiz-opt-t">{option.text}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <label className="quiz-blank">
            <span>Your answer</span>
            <input
              type="text"
              value={answers[question.id] ?? ''}
              onChange={(e) => answer(e.target.value)}
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
      </form>

      {problem && <p className="quiz-problem" role="alert">{problem}</p>}
      <div className="quiz-nav">
        <button type="button" className="btn btn-outline" onClick={() => setIndex(index - 1)} disabled={index === 0 || sending}>
          Back
        </button>
        {last ? (
          <>
            <span className="quiz-nav-note">{unanswered > 0 ? `${unanswered} not answered` : 'All answered'}</span>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={sending}>
              {sending ? 'Marking…' : 'Submit answers'}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setIndex(index + 1)}>
            Next
            <ArrowRightIcon />
          </button>
        )}
      </div>
    </>
  )
}
