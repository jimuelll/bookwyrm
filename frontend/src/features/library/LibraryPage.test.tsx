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
    expect(await screen.findByRole('heading', { level: 1, name: 'Ex Libris Bookworm Ana' })).toBeInTheDocument()
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
    await screen.findByRole('heading', { level: 1, name: 'Ex Libris Bookworm Ana' })
    expect(localStorage.getItem('bookwyrm-display-name:u-1')).toBe('Bookworm Ana')
  })
})

describe('library', () => {
  it('the bookplate carries the display name saved in Settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ display_name: 'Bookworm Ana', email: 'a@x.edu', chosen: true })))
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Ex Libris Bookworm Ana' })).toBeInTheDocument()
  })

  it('falls back to the Google name when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    openLibrary({ id: 'u-1', email: 'ana@school.edu', name: 'Ana Reyes' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Ex Libris Ana Reyes' })).toBeInTheDocument()
  })

  it('falls back to the start of the email when there is no other name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Ex Libris ana' })).toBeInTheDocument()
  })

  it('an empty library says what to do next and shows a blank catalogue card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    openLibrary({ id: 'u-1', email: 'ana@school.edu' })
    expect(await screen.findByRole('heading', { name: 'Nothing on your shelves yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload your first PDF' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Catalogue' })).toBeInTheDocument()
  })
})
