import { inkwellVignetteSvg, readingDeskSvg } from './engraving'

const scenes = { strip: readingDeskSvg, inkwell: inkwellVignetteSvg }
type SceneName = keyof typeof scenes

// The engravings are deterministic, so build each one's markup once per page load, not on every render.
const cache: Partial<Record<SceneName, string>> = {}

/**
 * An engraving of the reader's desk. Decoration only: hidden from screen readers, no text on it.
 * It fills its box (cropping edges to fit), so the parent sets the size or aspect ratio.
 */
export function ReadingDesk({ scene = 'strip', className = '' }: { scene?: SceneName; className?: string }) {
  const html = (cache[scene] ??= scenes[scene]())
  return <div className={`reading-desk ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
}
