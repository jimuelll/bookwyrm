import { InkWyrm } from './InkWyrm'
import type { WyrmMode } from './draw'
import './inkWyrm.css'

interface Props {
  /** What's happening, in a few words: "Logging you in…" */
  label: string
  /** A second, quieter line, e.g. "Reading p. 41 of 148" */
  detail?: string
  mode?: WyrmMode
  /** The label is the page's H1 (a page whose only content is this loader) */
  heading?: boolean
}

/**
 * A page-level loading state: the wyrm slithering above a small-caps label. The label is announced
 * to screen readers (role="status"), so the animation itself stays decorative.
 */
export function WyrmLoader({ label, detail, mode = 'slither', heading = false }: Props) {
  const Label = heading ? 'h1' : 'p'
  return (
    <div className="wyrm-loader" role="status" aria-live="polite">
      <InkWyrm mode={mode} width={240} height={110} cell={4} />
      <Label className="wyrm-loader-label">{label}</Label>
      {detail && <p className="wyrm-loader-detail">{detail}</p>}
    </div>
  )
}
