import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { DocumentStats } from '../../app/stats'
import { book, profile, quiz, stubApi } from '../../test/fakeApi'
import { createFakeBackend } from '../auth/fakeBackend'

function open(path: string) {
  window.history.pushState(null, '', path)
  render(<App authBackend={createFakeBackend({ signedIn: { id: 'u-1', email: 'ana@school.edu' } }).backend} />)
}

afterEach(() => vi.unstubAllGlobals())

const topic = (over: Partial<DocumentStats['weak'][number]>) => ({
  topic: 'Osmosis', right: 1, total: 4, percent: 25, pages: [31, 33], level: 'weak' as const, ...over,
})

const stats = (over: Partial<DocumentStats> = {}): DocumentStats => ({
  document_id: 'doc-1',
  document_title: 'Cell Biology',
  quizzes_taken: 2,
  passing_rate: 0.5,
  weak: [topic({})],
  learning: [topic({ topic: 'DNA', right: 3, total: 5, percent: 60, pages: [40], level: 'learning' })],
  strong: [topic({ topic: 'ATP', right: 5, total: 5, percent: 100, pages: [12], level: 'strong' })],
  unrated: [topic({ topic: 'Ribosomes', right: 0, total: 1, percent: 0, pages: [9], level: 'unrated' })],
  history: [
    { quiz_id: 'q-1', finished_at: '2026-11-10T10:00:00Z', score: 2, total: 5, percent: 40 },
    { quiz_id: 'q-2', finished_at: '2026-11-12T10:00:00Z', score: 4, total: 5, percent: 80 },
  ],
  ...over,
})

describe('the progress page', () => {
  it('shows how many quizzes passed, the topics by level with their pages, and the scores over time', async () => {
    stubApi({ '/profile': profile(), '/documents/doc-1/stats': () => Response.json(stats()) })
    open('/library/doc-1/stats')

    expect(await screen.findByRole('heading', { level: 1, name: 'Cell Biology' })).toBeInTheDocument()
    expect(screen.getByText('Quizzes taken').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Passed (70% or more)').nextSibling).toHaveTextContent('50%')
    expect(screen.getByRole('img', { name: 'Scores over time: 40%, then 80%' })).toBeInTheDocument()

    const weak = screen.getByRole('region', { name: 'Needs work' })
    expect(within(weak).getByText('1 of 4 right · 25%')).toBeInTheDocument()
    expect(within(weak).getByText('pp. 31, 33')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Strong' })).getByText('p. 12')).toBeInTheDocument()
    // the topic with too few answers is listed, but is not offered a quiz and is not called weak
    const unrated = screen.getByRole('region', { name: 'Not enough answers yet' })
    expect(within(unrated).getByText(/Ribosomes/)).toBeInTheDocument()
    expect(within(unrated).queryByRole('button')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Strong' })).queryByRole('button')).not.toBeInTheDocument()
  })

  it('starts a quiz on exactly the topic that was chosen', async () => {
    const user = userEvent.setup()
    let asked: unknown = null
    stubApi({
      '/profile': profile(),
      '/documents/doc-1/stats': () => Response.json(stats()),
      'POST /documents/doc-1/quizzes': (init) => {
        asked = JSON.parse(String(init.body))
        return Response.json(quiz({ id: 'quiz-new', status: 'generating', question_count: 0 }), { status: 202 })
      },
      '/quizzes/quiz-new': () => Response.json(quiz({ id: 'quiz-new' })),
    })
    open('/library/doc-1/stats')

    await user.click(await screen.findByRole('button', { name: 'Quiz me on DNA' }))

    expect(asked).toEqual({ topic: 'DNA', difficulty: 'medium', types: ['mcq'] })
  })

  it('leaves out a group with no topics', async () => {
    stubApi({
      '/profile': profile(),
      '/documents/doc-1/stats': () => Response.json(stats({ weak: [], unrated: [], learning: [] })),
    })
    open('/library/doc-1/stats')

    expect(await screen.findByRole('region', { name: 'Strong' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Needs work' })).not.toBeInTheDocument()
  })

  it('says there is nothing yet, and offers a quiz, before any quiz has been taken', async () => {
    stubApi({
      '/profile': profile(),
      '/documents/doc-1/stats': () =>
        Response.json(stats({ quizzes_taken: 0, passing_rate: null, weak: [], learning: [], strong: [], unrated: [], history: [] })),
    })
    open('/library/doc-1/stats')

    expect(await screen.findByText(/Nothing to show yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Write a quiz' })).toHaveAttribute('href', '/library/doc-1/quiz')
    expect(screen.queryByText('Quizzes taken')).not.toBeInTheDocument()
  })

  it('says so when the PDF is not on the reader’s shelf', async () => {
    stubApi({
      '/profile': profile(),
      '/documents/doc-1/stats': () => Response.json({ detail: 'That PDF isn’t in your library.' }, { status: 404 }),
    })
    open('/library/doc-1/stats')

    expect(await screen.findByRole('alert')).toHaveTextContent('That PDF isn’t in your library.')
  })
})

describe('the shelf', () => {
  it('links a ready book to its progress page', async () => {
    stubApi({
      '/profile': profile(),
      '/documents': () => Response.json([book({ id: 'doc-1', title: 'Cell Biology' })]),
      '/quizzes': () => Response.json([]),
    })
    open('/library')

    expect(await screen.findByRole('link', { name: 'See your progress on Cell Biology' })).toHaveAttribute(
      'href',
      '/library/doc-1/stats',
    )
  })
})
