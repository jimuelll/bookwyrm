import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { useTheme, type Theme } from '../hooks/useTheme'
import { useStartUpload, type Shell } from './shell'
import { TopBar } from './TopBar'
import { UploadContext, type LastUpload, type Uploads } from './upload/uploadContext'
import { UploadDialog } from './upload/UploadDialog'
import './shell.css'

/**
 * Every page: the pinned bar, then the page itself. Owns the theme so it survives page changes, and the
 * upload dialog, which any page's Upload button opens and which lands on the Library when it's done.
 */
export function AppLayout() {
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const { pathname, hash, key } = useLocation()
  const [uploading, setUploading] = useState(false)
  const [last, setLast] = useState<LastUpload | null>(null)

  // A client-side route change keeps the old scroll position, so reset it like a real page load,
  // or jump to the #section the link named (e.g. "How it works" from the About page).
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.()
    else window.scrollTo(0, 0)
  }, [pathname, hash, key])

  const uploads = useMemo<Uploads>(() => ({ open: () => setUploading(true), last }), [last])
  const shell: Shell = { theme }
  return (
    <UploadContext.Provider value={uploads}>
      <Bar theme={theme} onToggleTheme={toggle} />
      <Outlet context={shell} />
      <UploadDialog
        open={uploading}
        onClose={() => setUploading(false)}
        onUploaded={({ document, duplicate }) => {
          setUploading(false)
          setLast({ id: document.id, duplicate })
          navigate('/library')
        }}
      />
    </UploadContext.Provider>
  )
}

/** The bar, inside the provider so its Upload button can open the dialog. */
function Bar({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const startUpload = useStartUpload()
  return <TopBar theme={theme} onToggleTheme={onToggleTheme} onUpload={() => startUpload()} />
}
