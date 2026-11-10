import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRightIcon, BookmarkIcon, CheckIcon, CrossIcon } from '../../components/icons'
import { SAMPLE_QUESTIONS, SAMPLE_SOURCE } from './sampleQuiz.fixture'

const letters = ['A', 'B', 'C', 'D']
const numerals = ['i', 'ii', 'iii']

interface Props {
  id?: string
  /** Close the card and give the scene back; the opener restores focus to its trigger. */
  onClose: () => void
}

/** One interactive sample question, set like a loose page laid over the plate. Opened on demand. */
export function SampleQuestionCard({ id, onClose }: Props) {
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [announce, setAnnounce] = useState('')
  const promptRef = useRef<HTMLParagraphElement>(null)
  const uid = useId()

  // opened from the trigger: move focus into the card so keyboard and screen-reader users land on it
  useEffect(() => { promptRef.current?.focus() }, [])

  const q = SAMPLE_QUESTIONS[index]
  const answered = picked !== null
  const correct = picked === q.answer

  function choose(i: number) {
    if (answered) return
    setPicked(i)
    setAnnounce(
      i === q.answer
        ? `Correct. ${q.options[q.answer]}. The answer is on page ${q.page}.`
        : `Not quite. The answer is ${letters[q.answer]}, ${q.options[q.answer]}. It is on page ${q.page}.`,
    )
  }

  function toggleSource() {
    const next = !open
    setOpen(next)
    setAnnounce(next ? `Page ${q.page}: ${q.passage.highlight}` : 'Source passage hidden.')
  }

  function nextQuestion() {
    setIndex((index + 1) % SAMPLE_QUESTIONS.length)
    setPicked(null)
    setOpen(false)
    setAnnounce('')
    // keep keyboard users on the card: land on the new question
    requestAnimationFrame(() => promptRef.current?.focus())
  }

  return (
    <section
      className="sample"
      id={id}
      aria-labelledby={`${uid}-h`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
    >
      <header className="sample-head">
        <h2 id={`${uid}-h`}>Try a sample question</h2>
        <span className="sample-count">
          {numerals[index]} <span aria-hidden="true">of</span>
          <span className="sr-only"> of </span> {numerals[SAMPLE_QUESTIONS.length - 1]}
        </span>
        <button type="button" className="sample-close" onClick={onClose} aria-label="Close the sample question">
          <CrossIcon />
        </button>
      </header>
      <p className="sample-src">From <i>{SAMPLE_SOURCE}</i></p>

      <p className="sample-q" id={`${uid}-q`} ref={promptRef} tabIndex={-1}>{q.prompt}</p>

      {/* options and source passage share one cell, so revealing the passage never grows the card
          up over the scene; the options come back when the passage is closed */}
      <div className="sample-body">
        <ul className="sample-opts" role="list" aria-labelledby={`${uid}-q`} hidden={open}>
          {q.options.map((opt, i) => {
            const isAnswer = answered && i === q.answer
            const isWrongPick = answered && i === picked && !correct
            const state = isAnswer ? 'right' : isWrongPick ? 'wrong' : answered ? 'dim' : ''
            return (
              <li key={opt}>
                <button
                  type="button"
                  className={`opt ${state}`}
                  aria-disabled={answered || undefined}
                  onClick={() => choose(i)}
                >
                  <span className="opt-l" aria-hidden="true">{letters[i]}</span>
                  <span className="opt-t">{opt}</span>
                  {isAnswer && <span className="opt-mark"><CheckIcon />{i === picked ? 'Correct' : 'Answer'}</span>}
                  {isWrongPick && <span className="opt-mark"><CrossIcon />Your pick</span>}
                </button>
              </li>
            )
          })}
        </ul>

        <blockquote className="passage" id={`${uid}-src`} hidden={!(answered && open)}>
          <p>
            {q.passage.before} <mark>{q.passage.highlight}</mark> {q.passage.after}
          </p>
          <footer>{SAMPLE_SOURCE}, page {q.page}</footer>
        </blockquote>
      </div>

      <div className="sample-foot">
        {answered ? (
          <div className="sample-result">
            <span className={`verdict ${correct ? 'right' : 'wrong'}`}>
              {correct ? <CheckIcon /> : <CrossIcon />}
              {correct ? 'Correct' : 'Not quite'}
            </span>
            <button
              type="button"
              className="cite"
              aria-expanded={open}
              aria-controls={`${uid}-src`}
              onClick={toggleSource}
            >
              <BookmarkIcon />
              p. {q.page}
              <span className="sr-only">{open ? ', hide the source passage' : ', show the source passage'}</span>
            </button>
          </div>
        ) : (
          <span className="sample-note">Pick an answer</span>
        )}
        <button type="button" className="next" onClick={nextQuestion}>
          Next question
          <ArrowRightIcon />
        </button>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>
    </section>
  )
}
