import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { usePageTitle, useStartUpload } from '../../app/shell'
import { ArrowRightIcon, BookmarkIcon, CheckIcon, CrossIcon } from '../../components/icons'
import { useAuth } from '../auth/authContext'
import './about.css'

/* The paper artifacts below are illustrations of real screens, marked as samples. They are hidden
   from assistive tech; each section's text carries the meaning. */

function ModesArtifact() {
  const modes = [
    { name: 'Review mode', rows: [['Retake as often as you like', true], ['Shows your weak topics', true], ['No leaderboard', false]] },
    { name: 'Quiz mode', rows: [['One attempt only', true], ['Shows your weak topics', true], ['Leaderboard for this quiz', true]] },
  ] as const
  return (
    <div className="art art-modes" aria-hidden="true">
      {modes.map((m) => (
        <div className="mode" key={m.name}>
          <span className="art-run">{m.name}</span>
          {m.rows.map(([label, yes]) => (
            <span className={`mode-row${yes ? '' : ' no'}`} key={label}>
              {yes ? <CheckIcon /> : <CrossIcon />}
              {label}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function StatsArtifact() {
  return (
    <div className="art art-stats" aria-hidden="true">
      <span className="art-run">Sample · Cell Biology, ch. 7</span>
      <div className="conf">
        <span className="conf-n">80%</span>
        <span className="conf-l">
          Passing confidence
          <small>from your last 3 scores: 100, 70, 40</small>
        </span>
      </div>
      <span className="conf-bar"><span style={{ width: '80%' }} /></span>
      <span className="topic-row strong"><span>Strong · Glycolysis<small>pp. 120–126</small></span><b>9/10</b></span>
      <span className="topic-row weak"><span>Weak · Osmosis<small>pp. 201–204</small></span><b>2/5</b></span>
      <span className="art-btn">Quiz me on Osmosis</span>
    </div>
  )
}

function ShareArtifact() {
  const board = [
    { rank: 1, name: 'Ana', score: 95 },
    { rank: 2, name: 'Ben', score: 90 },
    { rank: 2, name: 'Cara', score: 90 },
    { rank: 4, name: 'You', score: 85 },
  ]
  return (
    <div className="art art-share" aria-hidden="true">
      <span className="art-run">Sample · Quiz mode</span>
      <span className="share-link"><span>bookwyrm.app/s/k7Qm…</span><small>expires in 5 days</small></span>
      <ol className="board">
        {board.map((r) => (
          <li key={r.name} className={r.name === 'You' ? 'you' : undefined}>
            <span className="board-rank">{r.rank}</span>
            <span className="board-name">{r.name}</span>
            <span className="board-score">{r.score}%</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function CitationArtifact() {
  return (
    <div className="art art-cite" aria-hidden="true">
      <span className="art-run">Sample · Source passage</span>
      <span className="cite-text">
        The inner membrane is folded into cristae, which <mark>greatly increase the surface area</mark> available
        for the electron transport chain.
      </span>
      <span className="cite-foot">
        <span className="art-chip"><BookmarkIcon />p. 142</span>
        <span className="cite-ok"><CheckIcon />Checked against this page</span>
      </span>
    </div>
  )
}

const features: { title: string; body: ReactNode; art: ReactNode }[] = [
  {
    title: 'Two ways to study',
    body: (
      <>
        <p><strong>Review mode</strong> is for practice. Retake it as often as you like, and each time you see which topics you are weak on and the pages to read again.</p>
        <p><strong>Quiz mode</strong> is a test. Everyone gets one attempt, and the quiz has its own leaderboard.</p>
      </>
    ),
    art: <ModesArtifact />,
  },
  {
    title: 'Know what to study next',
    body: (
      <>
        <p>Every PDF in your library keeps its own stats: your strong and weak topics, with their pages, and a passing confidence rate based on your three most recent scores.</p>
        <p>Pick a weak topic and get a short quiz on just those pages.</p>
      </>
    ),
    art: <StatsArtifact />,
  },
  {
    title: 'Quiz your class',
    body: (
      <>
        <p>Share any quiz with a link. Classmates log in to take it, and in review mode they can read the PDF too.</p>
        <p>You choose how long the link lasts, up to seven days. Then the quiz is deleted; your PDF and your stats stay.</p>
      </>
    ),
    art: <ShareArtifact />,
  },
  {
    title: 'Every answer has a page',
    body: (
      <>
        <p>Questions are written only from your PDF. A second check throws out any question its cited page does not answer.</p>
        <p>After you answer, open the citation to see the passage and the page it came from.</p>
      </>
    ),
    art: <CitationArtifact />,
  },
]

const internals = [
  {
    title: 'Retrieval',
    body: 'The PDF is split by heading, and passages are found by meaning and by exact words (pgvector and full-text search), so each question starts from the right pages.',
  },
  {
    title: 'Checked output',
    body: 'The model has to return each question in a strict format, with the passage it used and a quote from it. A quote that is not in the passage is rejected.',
  },
  {
    title: 'A second opinion',
    body: 'A separate check reads only the cited passage and drops any question it cannot answer from it.',
  },
  {
    title: 'Measured',
    body: 'Question and citation accuracy will be measured on real PDFs and published here.',
  },
]

export function AboutPage() {
  usePageTitle('About')
  const { user } = useAuth()
  const startUpload = useStartUpload()

  return (
    <main className="sheet about">
      <header className="about-head">
        <h1>What Bookwyrm does</h1>
        <p className="about-lede">
          Bookwyrm turns the PDFs you study from into quizzes, and every answer shows the page it came from. Here is
          what you can do with it.
        </p>
      </header>

      <div className="features">
        {features.map((f) => (
          <section className="feature" key={f.title}>
            <div className="feature-text">
              <h2>{f.title}</h2>
              {f.body}
            </div>
            <div className="feature-art">{f.art}</div>
          </section>
        ))}
      </div>

      <section className="internals" aria-labelledby="internals-h">
        <h2 id="internals-h">Under the hood</h2>
        <p className="internals-note">Bookwyrm is in early development. This is how it is designed to work.</p>
        <ul>
          {internals.map((i) => (
            <li key={i.title}>
              <h3>{i.title}</h3>
              <p>{i.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="about-end">
        <h2>Try it on your own PDF</h2>
        {user ? (
          <Link className="btn btn-primary btn-lg" to="/library">
            Go to your library
            <ArrowRightIcon />
          </Link>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => startUpload({ mode: 'signup', reason: 'Create an account to turn your PDFs into quizzes.' })}
          >
            Get started
            <ArrowRightIcon />
          </button>
        )}
      </section>
    </main>
  )
}
