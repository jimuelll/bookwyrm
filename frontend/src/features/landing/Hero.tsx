import { useEffect, useRef, useState } from 'react'
import {
  BookmarkIcon,
  ChevronDownIcon,
  FileIcon,
  PauseIcon,
  PlayIcon,
  QuizIcon,
  UploadIcon,
} from '../../components/icons'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import type { Theme } from '../../hooks/useTheme'
import type { StacksScene } from '../../scene/stacksScene'

interface Props {
  theme: Theme
}

/** The storybook spread: copy on the left page, the live painted library framed on the right. */
export function Hero({ theme }: Props) {
  const dark = theme === 'dark'
  const reducedMotion = usePrefersReducedMotion()
  // null = follow the reduced-motion setting; true/false = the reader pressed Play/Pause
  const [choice, setChoice] = useState<boolean | null>(null)
  const running = choice ?? !reducedMotion
  const [webglFailed, setWebglFailed] = useState(false)

  const heroRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const plateRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<StacksScene | null>(null)
  const initial = useRef({ dark, running })

  // Load three.js lazily so the page text paints before the 3D bundle arrives.
  useEffect(() => {
    let cancelled = false
    let created: StacksScene | null = null
    import('../../scene/stacksScene')
      .then(({ StacksScene }) => {
        if (cancelled || !canvasRef.current || !heroRef.current || !plateRef.current) return
        created = new StacksScene(canvasRef.current, heroRef.current, plateRef.current, initial.current)
        sceneRef.current = created
      })
      .catch(() => { if (!cancelled) setWebglFailed(true) })
    return () => {
      cancelled = true
      created?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => { sceneRef.current?.setDark(dark) }, [dark])
  useEffect(() => { sceneRef.current?.setRunning(running) }, [running])

  return (
    <section className="hero" ref={heroRef}>
      {webglFailed ? (
        <div className="hero-fallback" aria-hidden="true" />
      ) : (
        <canvas className="hero-scene" ref={canvasRef} aria-hidden="true" />
      )}

      <div className="book">
        <div className="page page-l">
          <div className="copy">
            <h1>
              <span className="drop">Q</span>uizzes from your PDFs, with the page for every answer.
            </h1>
            <p className="lede">
              Upload a textbook, a module or your lecture notes. Bookwyrm writes questions only from what is
              in it, checks each one, and shows you the page it came from.
            </p>
            <div className="actions">
              <a className="btn btn-primary btn-lg" href="#">
                <UploadIcon />
                Upload a PDF
              </a>
              <a className="text-link" href="#">or see a sample quiz</a>
            </div>
            <ol className="flow" aria-label="How Bookwyrm works">
              <li><span className="ic"><FileIcon /></span>Your PDF goes in</li>
              <li><span className="ic"><QuizIcon /></span>A quiz comes out</li>
              <li><span className="ic"><BookmarkIcon /></span>Each answer cites its page</li>
            </ol>
          </div>
          <span className="folio" aria-hidden="true">— i —</span>
        </div>

        <div className="page page-r">
          <div className="page-r-paper" />
          <div className="plate-frame" ref={plateRef} />
          <span className="running" aria-hidden="true">Plate the First</span>
          <p className="caption">
            The stacks by {dark ? 'lamplight' : 'daylight'}, where the wyrm reads ahead of you.
          </p>
          {!webglFailed && (
            <button className="pause" type="button" aria-pressed={!running} onClick={() => setChoice(!running)}>
              {running ? <PauseIcon /> : <PlayIcon />}
              {running ? 'Pause' : 'Play'}
            </button>
          )}
        </div>
      </div>

      <a className="scroll-hint" href="#how">
        How it works
        <ChevronDownIcon />
      </a>
    </section>
  )
}
