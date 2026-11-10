const steps = [
  { title: 'Upload a PDF', body: 'Bookwyrm reads it page by page and keeps track of every heading and page number.' },
  { title: 'Get a cited quiz', body: 'Every question comes from the text, is checked a second time, and links to its page.' },
  { title: 'Review what you missed', body: 'See your weak topics and get a follow-up quiz on just those pages.' },
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
