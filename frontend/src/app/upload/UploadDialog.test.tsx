import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { createFakeBackend } from '../../features/auth/fakeBackend'
import { book, profile, stubApi } from '../../test/fakeApi'
import type { LibraryDocument } from '../documents'

const ANA = { id: 'u-1', email: 'ana@school.edu' }

/** A stand-in for XMLHttpRequest that the test drives: report progress, then answer. */
class FakeXhr {
  static sent: FakeXhr[] = []
  url = ''
  headers: Record<string, string> = {}
  body: FormData | null = null
  aborted = false
  status = 0
  responseText = ''
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  open(_method: string, url: string) { this.url = url }
  setRequestHeader(name: string, value: string) { this.headers[name] = value }
  send(body: FormData) { this.body = body; FakeXhr.sent.push(this) }
  abort() { this.aborted = true; this.onabort?.() }
  progress(fraction: number) {
    act(() => this.upload.onprogress?.({ lengthComputable: true, loaded: fraction * 1000, total: 1000 } as ProgressEvent))
  }
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    act(() => this.onload?.())
  }
}

let shelf: LibraryDocument[] = []
beforeEach(() => {
  FakeXhr.sent = []
  shelf = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  stubApi({ '/profile': profile(), '/documents': () => Response.json(shelf) })
})
afterEach(() => vi.unstubAllGlobals())

const pdf = (name = 'Cell_Biology.pdf', size = 2048) => new File([new Uint8Array(size)], name, { type: 'application/pdf' })

async function openUpload(path = '/library') {
  window.history.pushState(null, '', path)
  render(<App authBackend={createFakeBackend({ signedIn: ANA }).backend} />)
  // applyAccept: false, so a wrong file reaches our own check, as a drop (which ignores `accept`) would
  const user = userEvent.setup({ applyAccept: false })
  const button = path === '/library'
    ? await screen.findByRole('button', { name: 'Upload your first PDF' })
    : await screen.findByRole('button', { name: 'Upload a PDF' })
  await user.click(button)
  const dialog = await screen.findByRole('dialog', { name: 'Upload a PDF' })
  return { user, dialog }
}

describe('uploading a PDF', () => {
  it('sends it with the reader’s token, shows progress, then puts the book on the shelf', async () => {
    const { user } = await openUpload()
    await user.upload(screen.getByLabelText('Choose a PDF'), pdf())

    const xhr = FakeXhr.sent[0]
    expect(xhr.url).toMatch(/\/documents$/)
    expect(xhr.headers.Authorization).toBe('Bearer token-for-u-1')
    expect((xhr.body?.get('file') as File).name).toBe('Cell_Biology.pdf')

    xhr.progress(0.4)
    expect(screen.getByRole('status')).toHaveTextContent('Uploading… 40%')
    xhr.progress(1)
    expect(screen.getByRole('status')).toHaveTextContent('Checking the PDF…')

    const queued = book({ title: 'Cell Biology', status: 'queued' })
    shelf = [queued]
    xhr.respond(202, queued)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('heading', { level: 3, name: 'Cell Biology' })).toBeInTheDocument()
    expect(screen.getByText('Waiting to be read…')).toBeInTheDocument()
  })

  it('refuses a file that isn’t a PDF before sending anything', async () => {
    const { user } = await openUpload()
    await user.upload(screen.getByLabelText('Choose a PDF'), new File(['hi'], 'notes.docx', { type: 'application/msword' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a PDF file.')
    expect(FakeXhr.sent).toHaveLength(0)
  })

  it('refuses a file over 25 MB before sending anything', async () => {
    const { user } = await openUpload()
    await user.upload(screen.getByLabelText('Choose a PDF'), pdf('huge.pdf', 25 * 1024 * 1024 + 1))
    expect(screen.getByRole('alert')).toHaveTextContent('The file is larger than 25 MB.')
    expect(FakeXhr.sent).toHaveLength(0)
  })

  it('shows the server’s reason when it refuses the file, and lets the reader choose another', async () => {
    const { user } = await openUpload()
    await user.upload(screen.getByLabelText('Choose a PDF'), pdf())
    FakeXhr.sent[0].respond(422, { detail: 'The PDF is password-protected. Remove the password and upload it again.' })

    expect(await screen.findByRole('alert')).toHaveTextContent('password-protected')
    expect(screen.getByRole('dialog', { name: 'Upload a PDF' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a PDF' })).toBeInTheDocument()
  })

  it('says when the same PDF is already on the shelf', async () => {
    const existing = book({ title: 'Cell Biology' })
    const { user } = await openUpload()
    await user.upload(screen.getByLabelText('Choose a PDF'), pdf())
    shelf = [existing]
    FakeXhr.sent[0].respond(200, existing)

    expect(await screen.findByText('Already on your shelf')).toBeInTheDocument()
  })

  it('Cancel stops the upload', async () => {
    const { user } = await openUpload()
    await user.upload(screen.getByLabelText('Choose a PDF'), pdf())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(FakeXhr.sent[0].aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Choose a PDF' })).toBeInTheDocument()
  })

  it('closing the dialog mid-upload cancels it', async () => {
    const { user } = await openUpload()
    await user.upload(screen.getByLabelText('Choose a PDF'), pdf())
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(FakeXhr.sent[0].aborted).toBe(true)
  })

  it('from any page, the bar’s Upload button opens it and a finished upload lands on the Library', async () => {
    const { user } = await openUpload('/about')
    await user.upload(screen.getByLabelText('Choose a PDF'), pdf())
    const queued = book({ title: 'Cell Biology', status: 'queued' })
    shelf = [queued]
    FakeXhr.sent[0].respond(202, queued)

    expect(await screen.findByRole('heading', { level: 3, name: 'Cell Biology' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/library')
  })
})
