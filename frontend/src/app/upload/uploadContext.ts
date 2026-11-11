import { createContext, useContext } from 'react'

/** The most recent upload, so the Library can refresh and point at it. A new object on every upload. */
export interface LastUpload {
  id: string
  /** It was already on the shelf; the API returned that book */
  duplicate: boolean
}

export interface Uploads {
  /** Open the upload dialog (callers check login first; see useStartUpload) */
  open: () => void
  last: LastUpload | null
}

export const UploadContext = createContext<Uploads | null>(null)

export function useUploads(): Uploads {
  const value = useContext(UploadContext)
  if (!value) throw new Error('useUploads must be used inside <AppLayout>')
  return value
}
