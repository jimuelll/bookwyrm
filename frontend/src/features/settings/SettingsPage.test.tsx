import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { createFakeBackend } from '../auth/fakeBackend'

const ANA = { id: 'u-1', email: 'ana@school.edu' }

/** A fake of our API at the network boundary: answers like the real /profile route. */
function fakeApi(initial: { display_name: string; chosen: boolean }) {
  let profile = { ...initial, email: ANA.email }
  const requests: { method: string; url: string; auth: string | null; body?: unknown }[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method: init.method ?? 'GET', url, auth: headers.get('Authorization'), body })
    if (new URL(url).pathname === '/documents') return Response.json([]) // the Library's shelf: empty
    if (init.method === 'PUT') {
      const name = String(body.display_name).trim()
      if (name.length > 40) return Response.json({ detail: 'Keep it to 40 characters or fewer.' }, { status: 422 })
      profile = { ...profile, display_name: name, chosen: true }
    }
    return Response.json(profile)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests }
}

function openSettings() {
  window.history.pushState(null, '', '/settings')
  const fake = createFakeBackend({ signedIn: ANA })
  render(<App authBackend={fake.backend} />)
  return userEvent.setup()
}

afterEach(() => vi.unstubAllGlobals())

describe('settings', () => {
  it('shows the current display name and says when it is only a suggestion', async () => {
    fakeApi({ display_name: 'ana', chosen: false })
    openSettings()

    expect(await screen.findByLabelText('Display name')).toHaveValue('ana')
    expect(screen.getByText(/comes from your account/i)).toBeInTheDocument()
  })

  it('saves a new name through the API with the login token', async () => {
    const { requests } = fakeApi({ display_name: 'ana', chosen: false })
    const user = openSettings()
    const input = await screen.findByLabelText('Display name')

    await user.clear(input)
    await user.type(input, '  Ana Reyes ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(input).toHaveValue('Ana Reyes')
    const put = requests.find((r) => r.method === 'PUT')!
    expect(put.url).toMatch(/\/profile$/)
    expect(put.auth).toBe('Bearer token-for-u-1')
  })

  it("shows the server's reason when it refuses a name", async () => {
    fakeApi({ display_name: 'ana', chosen: true })
    const user = openSettings()
    const input = await screen.findByLabelText('Display name')
    // the input stops at 40, so send a longer one the way a hand-made request could
    input.removeAttribute('maxlength')

    await user.clear(input)
    await user.type(input, 'x'.repeat(41))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Keep it to 40 characters or fewer.')
  })

  it('does not send an empty name', async () => {
    const { requests } = fakeApi({ display_name: 'ana', chosen: true })
    const user = openSettings()
    await user.clear(await screen.findByLabelText('Display name'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a display name.')
    expect(requests.some((r) => r.method === 'PUT')).toBe(false)
  })

  it('explains when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    openSettings()
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't reach the bookwyrm server/i)
  })

  it('is reachable from the account menu', async () => {
    fakeApi({ display_name: 'ana', chosen: true })
    window.history.pushState(null, '', '/library')
    render(<App authBackend={createFakeBackend({ signedIn: ANA }).backend} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Account' }))
    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  })
})
