import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { book, profile, stubApi } from '../../test/fakeApi'
import type { User } from '../auth/authContext'
import { createFakeBackend } from '../auth/fakeBackend'
import { addedLabel } from './books'

function openLibrary(user: User) {
  window.history.pushState(null, '', '/library')
  render(<App authBackend={createFakeBackend({ signedIn: user }).backend} />)
}

afterEach(() => vi.unstubAllGlobals())

const never = () => new Promise<Response>(() => {}) // an API that hasn't answered yet

describe('display name while the API is slow', () => {
  it('shows the name remembered from the last visit straight away', async () => {
    vi.stubGlobal('fetch', vi.fn(never))
    localStorage.setItem('bookwyrm-display-name:u-1', 'Bookworm Ana')
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Ex Libris Bookworm Ana’s library' })).toBeInTheDocument()
  })

  it('on a first visit shows a blank name line, never the email stand-in', async () => {
    vi.stubGlobal('fetch', vi.fn(never))
    openLibrary({ id: 'u-1', email: 'ana@school.edu', name: 'Ana Reyes' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Ex Libris' })).toBeInTheDocument()
    expect(screen.queryByText('ana')).not.toBeInTheDocument()
    expect(screen.queryByText('Ana Reyes')).not.toBeInTheDocument()
  })

  it("never shows another account's remembered name", async () => {
    vi.stubGlobal('fetch', vi.fn(never))
    localStorage.setItem('bookwyrm-display-name:someone-else', 'Not Ana')
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    await screen.findByRole('heading', { level: 1, name: 'Ex Libris' })
    expect(screen.queryByText('Not Ana')).not.toBeInTheDocument()
  })

  it('remembers the name the API returns for next time', async () => {
    stubApi({ '/profile': profile(), '/documents': () => Response.json([]) })
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    await screen.findByRole('heading', { level: 1, name: 'Ex Libris Bookworm Ana’s library' })
    expect(localStorage.getItem('bookwyrm-display-name:u-1')).toBe('Bookworm Ana')
  })
})

describe('library', () => {
  it('the bookplate carries the display name saved in Settings', async () => {
    stubApi({ '/profile': profile(), '/documents': () => Response.json([]) })
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Ex Libris Bookworm Ana’s library' })).toBeInTheDocument()
  })

  it('falls back to the Google name when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    openLibrary({ id: 'u-1', email: 'ana@school.edu', name: 'Ana Reyes' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Ex Libris Ana Reyes’s library' })).toBeInTheDocument()
  })

  it('falls back to the start of the email when there is no other name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Ex Libris ana’s library' })).toBeInTheDocument()
  })

  it('an empty library has one obvious thing to do', async () => {
    stubApi({ '/documents': () => Response.json([]) }) // the profile is down: the name falls back
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    expect(await screen.findByText('Your first book goes here')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Your books' })).toBeInTheDocument()
    expect(screen.getByText('No PDFs yet. Add one to get your first quiz.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload your first PDF' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'How it works' })).toBeInTheDocument()
  })

  it('the engraved desk is decoration only, hidden from screen readers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    await screen.findByRole('heading', { level: 2, name: 'Your books' })
    const desk = document.querySelector('.reading-desk')
    expect(desk).toHaveAttribute('aria-hidden', 'true')
    expect(desk?.querySelector('svg')).not.toBeNull()
    expect(desk?.querySelector('text')).toBeNull() // nothing to read on the picture
  })
})

describe('your books', () => {
  it('shows one row per PDF, as the API orders them (newest first), with its pages', async () => {
    stubApi({
      '/profile': profile(),
      '/documents': () =>
        Response.json([book({ title: 'Cell Biology', page_count: 148 }), book({ title: 'Constitutional Law', page_count: 1 })]),
    })
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })

    const shelf = (await screen.findByRole('heading', { level: 3, name: 'Cell Biology' })).closest('ul')!
    const titles = within(shelf).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Cell Biology', 'Constitutional Law'])
    expect(screen.getByText('148 pages · added today')).toBeInTheDocument()
    expect(screen.getByText('1 page · added today')).toBeInTheDocument()
    expect(screen.getByText('2 PDFs on your shelf.')).toBeInTheDocument()
    expect(screen.getAllByText('Ready')).toHaveLength(2)
    expect(screen.queryByText('Your first book goes here')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add a PDF/ })).toBeInTheDocument()
  })

  it('a book being read shows its step, and moves on to ready without a reload', async () => {
    const reading = book({ title: 'Cell Biology', status: 'extracting' })
    let asked = 0
    stubApi({
      '/profile': profile(),
      '/documents': () => Response.json([asked++ === 0 ? reading : { ...reading, status: 'ready' }]),
    })
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })

    expect(await screen.findByText('Reading the pages…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Reading Cell Biology' })).toHaveAttribute('value', '1')
    expect(await screen.findByText('Ready', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('stops asking once every book is ready', async () => {
    const { calls } = stubApi({ '/profile': profile(), '/documents': () => Response.json([book()]) })
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    await screen.findByText('Ready')
    await new Promise((r) => setTimeout(r, 1800))
    expect(calls.filter((c) => c.path === '/documents')).toHaveLength(1)
  })

  it('a PDF that could not be read says why, and can be removed', async () => {
    const failed = book({ title: 'Scanned notes', status: 'failed', error: 'No text could be read from this PDF.' })
    const { calls } = stubApi({
      '/profile': profile(),
      '/documents': () => Response.json([failed]),
      [`DELETE /documents/${failed.id}`]: () => new Response(null, { status: 204 }),
    })
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })

    expect(await screen.findByText('No text could be read from this PDF.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Scanned notes' }))
    await waitFor(() => expect(screen.queryByText('Scanned notes')).not.toBeInTheDocument())
    expect(calls).toContainEqual({ method: 'DELETE', path: `/documents/${failed.id}`, auth: 'Bearer token-for-u-1' })
    expect(screen.getByText('Your first book goes here')).toBeInTheDocument()
  })

  it('says so when the books cannot be loaded, and can try again', async () => {
    let up = false
    stubApi({
      '/profile': profile(),
      '/documents': () =>
        up ? Response.json([book({ title: 'Cell Biology' })]) : Promise.reject(new TypeError('Failed to fetch')),
    })
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })

    expect(await screen.findByRole('alert')).toHaveTextContent('reach the Bookwyrm server')
    expect(screen.queryByText('Your first book goes here')).not.toBeInTheDocument() // never claim it's empty
    up = true
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Cell Biology' })).toBeInTheDocument()
  })

  it('names when a book was added', () => {
    const now = new Date(2026, 10, 12, 15)
    expect(addedLabel(new Date(2026, 10, 12, 9).toISOString(), now)).toBe('added today')
    expect(addedLabel(new Date(2026, 10, 11, 23).toISOString(), now)).toBe('added yesterday')
    expect(addedLabel(new Date(2026, 10, 3).toISOString(), now)).toBe('added 3 Nov')
    expect(addedLabel(new Date(2025, 10, 3).toISOString(), now)).toBe('added 3 Nov 2025')
  })
})


describe('reading desk engraving', () => {
  it('comes out the same every time (seeded), so it never reshuffles between visits', async () => {
    const { readingDeskSvg, inkwellVignetteSvg } = await import('./desk/engraving')
    for (const draw of [readingDeskSvg, inkwellVignetteSvg]) {
      const svg = draw()
      expect(draw()).toBe(svg)
      expect(svg).not.toContain('NaN')
    }
    expect(inkwellVignetteSvg()).toContain('class="rd-wash"') // the panel's engraving is hand-coloured
  })
})
