import { Link, useParams } from 'react-router'
import { PASS_PERCENT, type DocumentStats, type Sitting, type TopicStat } from '../../app/stats'
import { usePageTitle } from '../../app/shell'
import { useResource } from '../../app/useResource'
import { WyrmLoader } from '../../components/inkWyrm/WyrmLoader'
import { useTopicQuiz } from '../quiz/useTopicQuiz'
import './stats.css'

const pagesLabel = (pages: number[]) => `${pages.length === 1 ? 'p.' : 'pp.'} ${pages.join(', ')}`

/** The groups of topics, in the order a reader should look at them: what needs work first. */
const GROUPS = [
  { key: 'weak', title: 'Needs work', note: 'Under 60% right.', quizzable: true },
  { key: 'learning', title: 'Getting there', note: '60 to 79% right.', quizzable: true },
  { key: 'strong', title: 'Strong', note: '80% or more right.', quizzable: false },
  { key: 'unrated', title: 'Not enough answers yet', note: 'Three answers are needed before a topic is rated.', quizzable: false },
] as const

/**
 * Scores over time, one point per quiz (its first attempt), as a small line. The numbers are written
 * out beside it, so the shape is never the only way to read them.
 */
function ScoreLine({ history }: { history: Sitting[] }) {
  const w = 320
  const h = 96
  const pad = 10
  const x = (i: number) => (history.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (history.length - 1))
  const y = (percent: number) => h - pad - (percent / 100) * (h - 2 * pad)
  const points = history.map((s, i) => `${x(i)},${y(s.percent)}`).join(' ')
  const summary = history.map((s) => `${s.percent}%`).join(', then ')
  return (
    <figure className="stats-line">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Scores over time: ${summary}`}>
        <line className="stats-pass" x1={pad} x2={w - pad} y1={y(PASS_PERCENT)} y2={y(PASS_PERCENT)} />
        {history.length > 1 && <polyline className="stats-trace" points={points} fill="none" />}
        {history.map((s, i) => (
          <circle key={s.quiz_id} className="stats-dot" cx={x(i)} cy={y(s.percent)} r="3.5" />
        ))}
      </svg>
      <figcaption>
        Each point is one quiz, first attempt. The dashed line is the {PASS_PERCENT}% pass mark.
      </figcaption>
    </figure>
  )
}

function TopicRow({ topic, quizzable, busy, onStart }: {
  topic: TopicStat
  quizzable: boolean
  busy: boolean
  onStart: (topic: string) => void
}) {
  return (
    <li className="stats-topic">
      <span className="stats-topic-name">
        {topic.topic} <span className="stats-topic-pages">{pagesLabel(topic.pages)}</span>
      </span>
      <span className="stats-topic-score">
        {topic.right} of {topic.total} right · {topic.percent}%
      </span>
      {quizzable && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => onStart(topic.topic)}
          disabled={busy}
          aria-label={`Quiz me on ${topic.topic}`}
        >
          Quiz me on this
        </button>
      )}
    </li>
  )
}

/**
 * How the reader is doing on one PDF: the weak and strong topics with the pages to revisit, how many of
 * their quizzes passed, and their scores over time. All of it comes from the first attempt at each quiz,
 * so "Take it again" practice never inflates it.
 */
export function StatsPage() {
  const { documentId } = useParams()
  const { data: stats, error } = useResource<DocumentStats>(documentId ? `/documents/${documentId}/stats` : null)
  usePageTitle(stats ? `Progress · ${stats.document_title}` : 'Progress')
  const topicQuiz = useTopicQuiz(documentId ?? '')

  if (error) {
    return (
      <main className="sheet gate">
        <h1>This PDF’s progress couldn’t be shown</h1>
        <p role="alert">{error}</p>
        <Link className="btn btn-outline" to="/library">Back to the library</Link>
      </main>
    )
  }
  if (!stats) {
    return (
      <main className="sheet" aria-busy="true">
        <WyrmLoader label="Gathering your results…" heading />
      </main>
    )
  }

  const rate = stats.passing_rate === null ? null : Math.round(stats.passing_rate * 100)
  return (
    <main className="sheet quiz stats">
      <header className="quiz-head">
        <p className="quiz-kicker">Progress</p>
        <h1>{stats.document_title}</h1>
      </header>

      {stats.quizzes_taken === 0 ? (
        <>
          <p className="quiz-lede">
            Nothing to show yet. Take a quiz on this PDF and the topics you know, and the ones to revisit,
            will appear here.
          </p>
          <div className="quiz-actions">
            <Link className="btn btn-primary btn-lg" to={`/library/${stats.document_id}/quiz`}>Write a quiz</Link>
            <Link className="text-link" to="/library">Back to the library</Link>
          </div>
        </>
      ) : (
        <>
          <dl className="stats-summary">
            <div>
              <dt>Quizzes taken</dt>
              <dd>{stats.quizzes_taken}</dd>
            </div>
            <div>
              <dt>Passed ({PASS_PERCENT}% or more)</dt>
              <dd>{rate}%</dd>
            </div>
          </dl>
          <ScoreLine history={stats.history} />

          {GROUPS.map(({ key, title, note, quizzable }) => {
            const topics = stats[key]
            if (topics.length === 0) return null
            return (
              <section key={key} className="stats-group" aria-labelledby={`stats-${key}`}>
                <h2 id={`stats-${key}`}>{title}</h2>
                <p className="stats-note">{note}</p>
                <ul>
                  {topics.map((t) => (
                    <TopicRow
                      key={t.topic}
                      topic={t}
                      quizzable={quizzable}
                      busy={topicQuiz.starting !== null}
                      onStart={topicQuiz.start}
                    />
                  ))}
                </ul>
              </section>
            )
          })}

          {topicQuiz.problem && <p className="quiz-problem" role="alert">{topicQuiz.problem}</p>}
          <p className="stats-foot">Only the first attempt at each quiz counts, so retaking one is free practice.</p>
          <div className="quiz-actions">
            <Link className="btn btn-primary btn-lg" to={`/library/${stats.document_id}/quiz`}>Write a quiz</Link>
            <Link className="text-link" to="/library">Back to the library</Link>
          </div>
        </>
      )}
    </main>
  )
}
