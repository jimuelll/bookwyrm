import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { useAuth } from '../../features/auth/authContext'
import { CrossIcon, FileIcon, UploadIcon, WyrmMark } from '../../components/icons'
import { ApiError } from '../api'
import { checkPdf, MAX_PAGES, MAX_UPLOAD_MB, uploadPdf, type Uploaded } from '../documents'
import '../../features/auth/auth.css'
import './upload.css'

interface Props {
  open: boolean
  onClose: () => void
  onUploaded: (result: Uploaded) => void
}

type Sending = { name: string; progress: number }

/**
 * "Upload a PDF": a native <dialog> in the login modal's frame. Choose a file or drop one on the dashed
 * area; it is checked here (type, size), sent with a progress bar, then the dialog closes and the
 * Library shows the book while the server reads it. Closing mid-upload cancels it.
 */
export function UploadDialog({ open, onClose, onUploaded }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="auth upload"
      aria-labelledby="upload-h"
      onClose={() => { if (open) onClose() }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* mounted only while open, so every opening starts fresh */}
      {open && <UploadForm onClose={onClose} onUploaded={onUploaded} />}
    </dialog>
  )
}

function UploadForm({ onClose, onUploaded }: Omit<Props, 'open'>) {
  const { backend } = useAuth()
  const uid = useId()
  const input = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState<Sending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const abort = useRef<AbortController | null>(null)

  // closing the dialog (×, Esc, backdrop) unmounts this form: stop any upload still going
  useEffect(() => () => abort.current?.abort(), [])

  async function send(file: File | undefined) {
    if (!file || sending) return
    const problem = checkPdf(file)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSending({ name: file.name, progress: 0 })
    const controller = new AbortController()
    abort.current = controller
    try {
      const result = await uploadPdf(await backend.getAccessToken(), file, {
        signal: controller.signal,
        onProgress: (progress) => setSending({ name: file.name, progress }),
      })
      onUploaded(result)
    } catch (e) {
      if (controller.signal.aborted) return
      setSending(null)
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
      if (input.current) input.current.value = '' // so choosing the same file again still fires
    }
  }

  function cancel() {
    abort.current?.abort()
    setSending(null)
    if (input.current) input.current.value = ''
  }

  function drop(e: DragEvent) {
    e.preventDefault() // otherwise the browser opens the dropped PDF itself
    setOver(false)
    void send(e.dataTransfer.files[0])
  }

  const percent = sending ? Math.round(sending.progress * 100) : 0
  // all the bytes are sent, but the server is still checking the PDF before it answers
  const checking = sending !== null && sending.progress >= 1

  return (
    <div className="auth-page">
      <div className="auth-head">
        <span className="auth-brand"><WyrmMark />Bookwyrm</span>
        <button type="button" className="auth-close" aria-label="Close" onClick={onClose}>
          <CrossIcon />
        </button>
      </div>
      <h2 id="upload-h">Upload a PDF</h2>
      <p className="auth-reason">Bookwyrm reads it and writes a quiz from it, with the page for every answer.</p>

      {sending ? (
        <div className="upload-sending">
          <p className="upload-file"><FileIcon />{sending.name}</p>
          <progress className="upload-bar" max={100} value={checking ? undefined : percent} aria-labelledby={`${uid}-st`} />
          <div className="upload-row">
            <p className="upload-status" id={`${uid}-st`} role="status">
              {checking ? 'Checking the PDF…' : `Uploading… ${percent}%`}
            </p>
            <button type="button" className="auth-forgot" onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <div
          className={`upload-drop${over ? ' is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <p className="upload-drop-title">Drop a PDF here</p>
          <p className="auth-or" aria-hidden="true"><span>or</span></p>
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
            <UploadIcon />
            Choose a PDF
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="upload-input"
            aria-label="Choose a PDF"
            tabIndex={-1}
            onChange={(e) => void send(e.target.files?.[0])}
          />
        </div>
      )}

      <p className="auth-hint">PDFs with selectable text, up to {MAX_UPLOAD_MB} MB and {MAX_PAGES} pages. Scanned pages can’t be read yet.</p>
      <p className="auth-error" role="alert">{error}</p>
    </div>
  )
}
