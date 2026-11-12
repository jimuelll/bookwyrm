import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { Attempt } from '../../app/quizzes'
import { book, profile, quiz, scope, stubApi } from '../../test/fakeApi'
import { createFakeBackend } from '../auth/fakeBackend'
import { missedTopics } from './missedTopics'

function open(path: string) {
  window.history.pushState(null, '', path)
  render(<App authBackend={createFakeBackend({ signedIn: { id: 'u-1', email: 'ana@school.edu' } }).backend} />)
}

afterEach(() => vi.unstubAllGlobals())

const sent = (init: RequestInit) => JSON.parse(String(init.body)) as unknown

/** An attempt at a two-question quiz: one multiple choice (options already shuffled), one true/false. */
const open_attempt: Attempt = {
  id: 'att-1',
  quiz_id: 'quiz-1',
  document_id: 'doc-1',
  document_title: 'Cell Biology',
  total: 2,
  score: null,
  finished: false,
  questions: [
    {
      id: 'q-atp',
      type: 'mcq',
      prompt: 'Which organelle produces most of a cell’s ATP?',
      options: [
        { id: 'c', text: 'Ribosomes' },
        { id: 'b', text: 'Mitochondria' },
        { id: 'a', text: 'The nucleus' },
        { id: 'd', text: 'Chloroplasts' },
      ],
      topic: 'Organelles',
      result: null,
    },
    { id: 'q-osmosis', type: 'true_false', prompt: 'Osmosis moves water toward more solute.', options: null, topic: 'Osmosis', result: null },
  ],
}

const marked: Attempt = {
  ...open_attempt,
  score: 1,
  finished: true,
  questions: [
    {
      ...open_attempt.questions[0],
      result: {
        response: 'b',
        is_correct: true,
        answer: 'Mitochondria',
        correct_option_id: 'b',
        explanation: 'The passage says mitochondria make most of the ATP.',
        page: 12,
        evidence: 'Mitochondria produce most of the ATP that a cell uses.',
      },
    },
    {
      ...open_attempt.questions[1],
      result: {
        response: 'False',
        is_correct: false,
        answer: 'True',
        correct_option_id: null,
        explanation: 'Water moves toward the higher solute concentration.',
        page: 31,
        evidence: 'Osmosis moves water across a membrane toward more solute.',
      },
    },
  ],
}

describe('asking for a quiz', () => {
  it('sends what the reader chose, then waits on the quiz page until it is written', async () => {
    const user = userEvent.setup()
    let asked: unknown = null
    let checks = 0
    stubApi({
      '/profile': profile(),
      '/documents/doc-1': () => Response.json(book({ id: 'doc-1', title: 'Cell Biology' })),
      '/documents/doc-1/quiz-scope': () => Response.json(scope()),
      'POST /documents/doc-1/quizzes': (init) => {
        asked = sent(init)
        return Response.json(quiz({ status: 'generating', question_count: 0 }), { status: 202 })
      },
      // still being written the first time the page asks, ready the second
      '/quizzes/quiz-1': () => Response.json(quiz(checks++ === 0 ? { status: 'generating', question_count: 0 } : {})),
    })
    open('/library/doc-1/quiz')

    await user.click(await screen.findByRole('radio', { name: '10 questions' }))
    await user.click(screen.getByRole('checkbox', { name: 'True or false' }))
    await user.click(screen.getByRole('button', { name: 'Write my quiz' }))

    expect(asked).toEqual({ count: 10, difficulty: 'medium', types: ['mcq', 'true_false'] })
    expect(await screen.findByText('Finding the passages…')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Begin' }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your quiz is ready') // the wyrm's road ends here
  })

  it('cannot be sent with no kind of question chosen', async () => {
    const user = userEvent.setup()
    stubApi({
      '/profile': profile(),
      '/documents/doc-1': () => Response.json(book({ id: 'doc-1' })),
      '/documents/doc-1/quiz-scope': () => Response.json(scope()),
    })
    open('/library/doc-1/quiz')

    await screen.findByRole('radio', { name: '8 questions' })
    expect(screen.getByRole('button', { name: 'Write my quiz' })).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: 'Multiple choice' }))

    expect(screen.getByRole('button', { name: 'Write my quiz' })).toBeDisabled()
  })

  it('offers the numbers of questions that suit the PDF, with the suggested one chosen', async () => {
    const user = userEvent.setup()
    let asked: unknown = null
    stubApi({
      '/profile': profile(),
      '/documents/doc-1': () => Response.json(book({ id: 'doc-1' })),
      // a short PDF: 4 suggested, enough material for 7
      '/documents/doc-1/quiz-scope': () => Response.json(scope({ passages: 1, page_last: 2, suggested_count: 4, max_count: 7 })),
      'POST /documents/doc-1/quizzes': (init) => {
        asked = sent(init)
        return Response.json(quiz({ status: 'generating' }), { status: 202 })
      },
    })
    open('/library/doc-1/quiz')

    expect(await screen.findByRole('radio', { name: '4 questions' })).toBeChecked()
    expect(screen.getAllByRole('radio', { name: /questions?$/ }).map((r) => r.getAttribute('aria-label'))).toEqual([
      '3 questions',
      '4 questions',
      '5 questions',
    ])
    expect(screen.getByText(/enough material for up to 7/)).toBeInTheDocument()

    // any other number can be typed, and is held to what the PDF can carry
    await user.type(screen.getByRole('spinbutton', { name: 'Another number of questions, up to 7' }), '9')
    await user.click(screen.getByRole('button', { name: 'Write my quiz' }))

    expect(asked).toEqual({ count: 7, difficulty: 'medium', types: ['mcq'] })
  })

  it('can focus on one topic: says where the PDF covers it and sizes the quiz to that', async () => {
    const user = userEvent.setup()
    let asked: unknown = null
    stubApi({
      '/profile': profile(),
      '/documents/doc-1': () => Response.json(book({ id: 'doc-1' })),
      '/documents/doc-1/quiz-scope': (_, url) => {
        const topic = url.searchParams.get('topic')
        return Response.json(topic ? scope({ topic, passages: 2, page_first: 30, page_last: 33, suggested_count: 3, max_count: 12 }) : scope())
      },
      'POST /documents/doc-1/quizzes': (init) => {
        asked = sent(init)
        return Response.json(quiz({ status: 'generating', topic: 'osmosis' }), { status: 202 })
      },
    })
    open('/library/doc-1/quiz')

    await user.click(await screen.findByRole('radio', { name: 'One topic' }))
    expect(screen.getByRole('button', { name: 'Write my quiz' })).toBeDisabled() // no topic yet
    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'osmosis')

    expect(await screen.findByText('Found in 2 passages, pp. 30–33.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '3 questions' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Write my quiz' }))

    expect(asked).toEqual({ count: 3, difficulty: 'medium', types: ['mcq'], topic: 'osmosis' })
  })

  it('says so when the PDF never mentions the topic, and will not send it', async () => {
    const user = userEvent.setup()
    stubApi({
      '/profile': profile(),
      '/documents/doc-1': () => Response.json(book({ id: 'doc-1' })),
      '/documents/doc-1/quiz-scope': (_, url) =>
        Response.json(scope({ topic: url.searchParams.get('topic'), passages: 0, page_first: null, page_last: null, suggested_count: 0, max_count: 0 })),
    })
    open('/library/doc-1/quiz')

    await user.click(await screen.findByRole('radio', { name: 'One topic' }))
    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'tax law')

    expect(await screen.findByText(/Nothing in this PDF mentions “tax law”/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write my quiz' })).toBeDisabled()
  })

  it('says why when the server refuses', async () => {
    const user = userEvent.setup()
    stubApi({
      '/profile': profile(),
      '/documents/doc-1': () => Response.json(book({ id: 'doc-1' })),
      '/documents/doc-1/quiz-scope': () => Response.json(scope()),
      'POST /documents/doc-1/quizzes': () =>
        Response.json({ detail: 'A quiz is already being written for you. Wait for it to finish.' }, { status: 409 }),
    })
    open('/library/doc-1/quiz')

    await screen.findByRole('radio', { name: '8 questions' })
    await user.click(screen.getByRole('button', { name: 'Write my quiz' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A quiz is already being written for you.')
  })
})

describe('the quiz page', () => {
  it('while a quiz is written, says which stage it is at and how far along', async () => {
    const checking = { stage: 'checking' as const, fraction: 0.62, round: 1, wanted: 5, kept: 0, candidates: 8, checked: 3 }
    stubApi({
      '/profile': profile(),
      '/quizzes/quiz-1': () => Response.json(quiz({ status: 'generating', question_count: 0, progress: checking })),
    })
    open('/quizzes/quiz-1')

    expect(await screen.findByText('Checking each one against its page: 3 of 8')).toBeInTheDocument()
    expect(screen.getByText('Checks')).toHaveAttribute('aria-current', 'step')
    expect(screen.queryByRole('button', { name: 'Begin' })).not.toBeInTheDocument()
  })

  it('a quiz opened when it is already written just shows itself, with no journey', async () => {
    stubApi({ '/profile': profile(), '/quizzes/quiz-1': () => Response.json(quiz()) })
    open('/quizzes/quiz-1')

    expect(await screen.findByRole('button', { name: 'Begin' })).toBeInTheDocument()
    expect(screen.queryByText('Your quiz is ready')).not.toBeInTheDocument()
  })

  it('says why a quiz could not be written and offers to ask again', async () => {
    stubApi({
      '/profile': profile(),
      '/quizzes/quiz-1': () => Response.json(quiz({ status: 'failed', error: 'There is no readable text in the selected pages.' })),
    })
    open('/quizzes/quiz-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('There is no readable text in the selected pages.')
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/library/doc-1/quiz')
  })

  it('says so when fewer questions passed the checks than were asked for', async () => {
    stubApi({ '/profile': profile(), '/quizzes/quiz-1': () => Response.json(quiz({ count: 5, question_count: 2 })) })
    open('/quizzes/quiz-1')

    expect(await screen.findByText(/You asked for 5. Only 2 passed the checks/)).toBeInTheDocument()
  })
})

describe('taking a quiz', () => {
  it('sends the chosen option ids, and the results show each answer with its page', async () => {
    const user = userEvent.setup()
    let submitted: unknown = null
    stubApi({
      '/profile': profile(),
      '/quizzes/quiz-1': () => Response.json(quiz()),
      'POST /quizzes/quiz-1/attempts': () => Response.json(open_attempt, { status: 201 }),
      '/attempts/att-1': () => Response.json(open_attempt),
      'POST /attempts/att-1/submit': (init) => {
        submitted = sent(init)
        return Response.json(marked)
      },
    })
    open('/quizzes/quiz-1')

    await user.click(await screen.findByRole('button', { name: 'Begin' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Question 1 of 2' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Mitochondria' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('radio', { name: 'False' }))
    expect(screen.getByText('All answered')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    // the option's id goes to the server, not its text or its position on screen
    expect(submitted).toEqual({ answers: { 'q-atp': 'b', 'q-osmosis': 'False' } })
    expect(await screen.findByRole('heading', { level: 1, name: '1 of 2 correct' })).toBeInTheDocument()
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first).getByText('Correct')).toBeInTheDocument()
    expect(within(first).getByText('Cell Biology, p. 12')).toBeInTheDocument()
    expect(within(second).getByText('Not quite')).toBeInTheDocument()
    expect(within(second).getByText('Osmosis moves water across a membrane toward more solute.')).toBeInTheDocument()
    expect(within(second).getByText('Cell Biology, p. 31')).toBeInTheDocument()
  })

  it('says how many questions have no answer before submitting, and leaves them out', async () => {
    const user = userEvent.setup()
    let submitted: unknown = null
    stubApi({
      '/profile': profile(),
      '/attempts/att-1': () => Response.json(open_attempt),
      'POST /attempts/att-1/submit': (init) => {
        submitted = sent(init)
        return Response.json(marked)
      },
    })
    open('/attempts/att-1')

    await user.click(await screen.findByRole('button', { name: 'Next' }))
    expect(screen.getByText('2 not answered')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit answers' }))

    expect(submitted).toEqual({ answers: {} })
  })

  it('opening a finished attempt shows its results, with a way to take it again', async () => {
    stubApi({ '/profile': profile(), '/attempts/att-1': () => Response.json(marked) })
    open('/attempts/att-1')

    expect(await screen.findByRole('heading', { level: 1, name: '1 of 2 correct' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take it again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit answers' })).not.toBeInTheDocument()
  })
})

describe('studying what was missed', () => {
  it('offers a short quiz on each missed topic, with its pages, and asks the server for exactly that topic', async () => {
    const user = userEvent.setup()
    let asked: unknown = null
    stubApi({
      '/profile': profile(),
      '/attempts/att-1': () => Response.json(marked),
      'POST /documents/doc-1/quizzes': (init) => {
        asked = sent(init)
        return Response.json(quiz({ id: 'quiz-review', topic: 'Osmosis', status: 'generating', question_count: 0 }), { status: 202 })
      },
      '/quizzes/quiz-review': () => Response.json(quiz({ id: 'quiz-review', topic: 'Osmosis' })),
    })
    open('/attempts/att-1')

    const study = await screen.findByRole('region', { name: 'What to study' })
    // only the topic that was missed is listed (the mitochondria question was right), with the page it came from
    expect(within(study).getAllByRole('listitem')).toHaveLength(1)
    expect(within(study).getByText('p. 31')).toBeInTheDocument()
    await user.click(within(study).getByRole('button', { name: 'Quiz me on Osmosis' }))

    // no count: the server sizes the quiz to how much the PDF says about the topic
    expect(asked).toEqual({ topic: 'Osmosis', difficulty: 'medium', types: ['mcq'] })
    expect(await screen.findByText(/Osmosis/)).toBeInTheDocument()
  })

  it('has nothing to study after a perfect score', async () => {
    const perfect: Attempt = {
      ...marked,
      score: 2,
      questions: marked.questions.map((q) => ({ ...q, result: q.result && { ...q.result, is_correct: true } })),
    }
    stubApi({ '/profile': profile(), '/attempts/att-1': () => Response.json(perfect) })
    open('/attempts/att-1')

    expect(await screen.findByRole('heading', { level: 1, name: '2 of 2 correct' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'What to study' })).not.toBeInTheDocument()
  })

  it('merges questions on the same topic and lists their pages in order', () => {
    const wrong = (topic: string, page: number) => ({
      ...open_attempt.questions[0],
      topic,
      result: { ...marked.questions[1].result!, page },
    })

    expect(missedTopics([wrong('ATP', 40), wrong('atp', 12), wrong('Osmosis', 31), wrong('ATP', 12)])).toEqual([
      { topic: 'ATP', pages: [12, 40] },
      { topic: 'Osmosis', pages: [31] },
    ])
  })
})

describe('the shelf', () => {
  it('links a ready book to its quiz, and a book without one to writing one', async () => {
    stubApi({
      '/profile': profile(),
      '/documents': () => Response.json([book({ id: 'doc-1', title: 'Cell Biology' }), book({ id: 'doc-2', title: 'Constitutional Law' })]),
      '/quizzes': () => Response.json([quiz({ id: 'quiz-9', document_id: 'doc-1' })]),
    })
    open('/library')

    expect(await screen.findByRole('link', { name: 'Take the quiz on Cell Biology' })).toHaveAttribute('href', '/quizzes/quiz-9')
    expect(screen.getByRole('link', { name: 'Write a quiz from Constitutional Law' })).toHaveAttribute('href', '/library/doc-2/quiz')
  })
})
