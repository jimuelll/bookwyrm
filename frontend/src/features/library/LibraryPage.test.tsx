import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { User } from '../auth/authContext'
import { createFakeBackend } from '../auth/fakeBackend'

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
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ display_name: 'Bookworm Ana', email: 'a@x.edu', chosen: true })))
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    await screen.findByRole('heading', { level: 1, name: 'Ex Libris Bookworm Ana’s library' })
    expect(localStorage.getItem('bookwyrm-display-name:u-1')).toBe('Bookworm Ana')
  })
})

describe('library', () => {
  it('the bookplate carries the display name saved in Settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ display_name: 'Bookworm Ana', email: 'a@x.edu', chosen: true })))
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
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    expect(await screen.findByRole('heading', { level: 2, name: 'Your books' })).toBeInTheDocument()
    expect(screen.getByText('Your first book goes here')).toBeInTheDocument()
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
