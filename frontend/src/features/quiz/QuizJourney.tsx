import { useEffect, useState, type CSSProperties } from 'react'
import type { QuizProgress } from '../../app/quizzes'
import { CheckIcon } from '../../components/icons'
import { InkWyrm } from '../../components/inkWyrm/InkWyrm'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'

const STOPS = ['Passages', 'Questions', 'Checks', 'Quiz']
// Between two reports from the server the wyrm keeps inching forward, so a slow step never looks stuck.
// It may run this far ahead of what is known, and never past this point until the quiz really is ready.
const HEADROOM = 0.12
const FURTHEST_UNCONFIRMED = 0.93
const ARRIVE_MS = 900 // the last stretch to the books, before it curls up on them

interface Props {
  /** What the server last said; null before the first report (it is still picking the passages) */
  progress: QuizProgress | null
  /** The quiz is ready: the wyrm finishes the road and settles on the books */
  arrived: boolean
}

/** What is happening now, in words; this is the part a screen reader hears. */
function label(progress: QuizProgress | null, arrived: boolean) {
  if (arrived) return 'Your quiz is ready'
  if (!progress) return 'Finding the passages…'
  if (progress.stage === 'writing') {
    const more = progress.wanted - progress.kept
    return progress.round === 1 ? 'Writing the questions…' : `Writing ${more} more to replace the ones that failed…`
  }
  return `Checking each one against its page: ${progress.checked} of ${progress.candidates}`
}

/**
 * The wait while a quiz is written, as a journey: the Ink-glyph Wyrm crosses the page toward a stack of
 * books, passing a stop for each real stage of the work (the server reports them, backend
 * `Progress`), and curls up on the books when the quiz is ready. Decoration over a plain progress rule
 * and a status line that carry the meaning.
 */
export function QuizJourney({ progress, arrived }: Props) {
  const reduced = usePrefersReducedMotion()
  const known = progress?.fraction ?? 0.03
  const [crept, setCrept] = useState(0)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (arrived || reduced) return
    const ceiling = Math.min(FURTHEST_UNCONFIRMED, known + HEADROOM)
    // each tick closes a small share of the gap that is left: quick at first, then ever slower
    const timer = setInterval(() => setCrept((at) => Math.max(at, known) + (ceiling - Math.max(at, known)) * 0.06), 400)
    return () => clearInterval(timer)
  }, [known, arrived, reduced])

  useEffect(() => {
    if (!arrived) return
    const timer = setTimeout(() => setSettled(true), reduced ? 0 : ARRIVE_MS)
    return () => clearTimeout(timer)
  }, [arrived, reduced])

  const at = arrived ? 1 : Math.max(known, reduced ? 0 : crept)
  const stop = arrived ? 3 : !progress ? 0 : progress.stage === 'writing' ? 1 : 2

  return (
    <div className={`journey${settled ? ' is-settled' : ''}`} style={{ '--at': at } as CSSProperties}>
      <div className="journey-road" aria-hidden="true">
        {settled ? (
          // arrived: curled up on the books it was heading for
          <InkWyrm mode="coil" width={120} height={108} cell={3} className="journey-rest" />
        ) : (
          <>
            <div className="journey-wyrm">
              <InkWyrm mode="slither" width={144} height={66} cell={3} speed={arrived ? 1.6 : 1} />
            </div>
            <div className="journey-books"><span /><span /><span /></div>
          </>
        )}
      </div>
      <progress className="quiz-progress" max={1} value={at} aria-hidden="true" />
      <ol className="journey-stops">
        {STOPS.map((name, i) => (
          <li key={name} className={i < stop || arrived ? 'is-done' : i === stop ? 'is-now' : ''} aria-current={i === stop && !arrived ? 'step' : undefined}>
            {(i < stop || arrived) && <CheckIcon />}
            {name}
          </li>
        ))}
      </ol>
      <p className="journey-label" role="status">{label(progress, arrived)}</p>
      {!arrived && progress && progress.kept > 0 && (
        <p className="journey-detail">{progress.kept} of {progress.wanted} kept so far.</p>
      )}
    </div>
  )
}
