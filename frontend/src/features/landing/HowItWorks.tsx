import type { ReactNode } from 'react'
import { BookmarkIcon, CheckIcon } from '../../components/icons'

/* Small paper artifacts drawn in HTML/CSS. They illustrate the step text beside them, so
   they are hidden from assistive tech; the step copy carries the meaning. */

function PageArtifact() {
  return (
    <div className="art art-page" aria-hidden="true">
      <span className="art-run">Chapter VII</span>
      <span className="art-h"><span className="art-tag">H1</span>Cellular respiration</span>
      <span className="art-line" /><span className="art-line" /><span className="art-line short" />
      <span className="art-h sub"><span className="art-tag">H2</span>7.2 The mitochondrion</span>
      <span className="art-line" /><span className="art-line short" />
      <span className="art-folio">142</span>
    </div>
  )
}

function QuestionArtifact() {
  return (
    <div className="art art-q" aria-hidden="true">
      <span className="art-qtext">Where do the light-dependent reactions take place?</span>
      <span className="art-opt">In the stroma</span>
      <span className="art-opt right"><CheckIcon />In the thylakoid membranes</span>
      <span className="art-chip"><BookmarkIcon />p. 87</span>
    </div>
  )
}

function WeakTopicsArtifact() {
  const topics = [
    { name: 'Osmosis', pages: 'pp. 201–204', score: 2, of: 5 },
    { name: 'Light reactions', pages: 'pp. 86–88', score: 3, of: 6 },
  ]
  return (
    <div className="art art-weak" aria-hidden="true">
      <span className="art-run">Weak topics</span>
      {topics.map((t) => (
        <span className="art-topic" key={t.name}>
          <span className="art-topic-n">{t.name}<small>{t.pages}</small></span>
          <span className="art-topic-s">{t.score}/{t.of}</span>
        </span>
      ))}
      <span className="art-btn">Quiz me on these pages</span>
    </div>
  )
}

const steps: { title: string; body: string; art: ReactNode }[] = [
  {
    title: 'Upload a PDF',
    body: 'Bookwyrm reads it page by page and keeps track of every heading and page number.',
    art: <PageArtifact />,
  },
  {
    title: 'Get a cited quiz',
    body: 'Every question comes from the text, is checked a second time, and links to its page.',
    art: <QuestionArtifact />,
  },
  {
    title: 'Review what you missed',
    body: 'See your weak topics and get a follow-up quiz on just those pages.',
    art: <WeakTopicsArtifact />,
  },
]
const numerals = ['I', 'II', 'III']

export function HowItWorks() {
  return (
    <section className="how" id="how">
      <div className="how-in">
        <h2>From your PDF to a quiz you can check</h2>
        <ol>
          {steps.map((s, i) => (
            <li key={s.title}>
              {s.art}
              <span className="num">{numerals[i]}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
