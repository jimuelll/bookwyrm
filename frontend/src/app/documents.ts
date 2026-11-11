import { API_BASE, ApiError, errorMessage } from './api'

/** The ingestion steps, as the API reports them (backend/app/documents.py). */
export type DocumentStatus = 'queued' | 'extracting' | 'chunking' | 'ready' | 'failed'

/** One uploaded PDF: a book on the reader's shelf. */
export interface LibraryDocument {
  id: string
  title: string
  filename: string
  page_count: number | null
  status: DocumentStatus
  /** Why it failed, written for the reader; null unless status is "failed" */
  error: string | null
  created_at: string
  updated_at: string
}

/** Still being read: the Library polls until none are. */
export const isReading = (status: DocumentStatus) => status === 'queued' || status === 'extracting' || status === 'chunking'

// The server's limits (backend/app/config.py). Checked here too only so a wrong file is refused before
// it's sent; the server checks again, because anything the browser checks can be skipped.
export const MAX_UPLOAD_MB = 25
export const MAX_PAGES = 500

/** Why this file can't be uploaded, or null if it looks fine. The server has the final say. */
export function checkPdf(file: File): string | null {
  const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (!looksLikePdf) return 'Choose a PDF file.'
  if (file.size === 0) return 'The file is empty.'
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `The file is larger than ${MAX_UPLOAD_MB} MB.`
  return null
}

export interface Uploaded {
  document: LibraryDocument
  /** The reader already had this exact file; the API returned that book instead of a copy */
  duplicate: boolean
}

/**
 * POST a PDF to /documents, reporting progress from 0 to 1 as the bytes go up.
 *
 * This uses XMLHttpRequest rather than fetch because fetch can't report upload progress. The body is
 * FormData (a multipart request); we don't set Content-Type ourselves, because the browser must write
 * it with the boundary string that separates the parts.
 */
export function uploadPdf(
  token: string | null,
  file: File,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/documents`)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        // not JSON (a proxy's error page, say): the status code decides the message
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ document: body as LibraryDocument, duplicate: xhr.status === 200 })
      } else {
        reject(new ApiError(errorMessage(xhr.status, body), xhr.status))
      }
    }
    xhr.onerror = () => reject(new ApiError("Couldn't reach the Bookwyrm server. Check your connection and try again.", 0))
    xhr.onabort = () => reject(new DOMException('The upload was cancelled.', 'AbortError'))
    if (signal?.aborted) {
      reject(new DOMException('The upload was cancelled.', 'AbortError'))
      return
    }
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })

    const body = new FormData()
    body.append('file', file, file.name)
    xhr.send(body)
  })
}
