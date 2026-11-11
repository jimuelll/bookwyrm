import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, ChevronDownIcon, PauseIcon, PlayIcon, QuizIcon } from '../../components/icons'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import type { Theme } from '../../hooks/useTheme'
import type { StacksScene } from '../../scene/stacksScene'
import { SampleQuestionCard } from './SampleQuestionCard'

/**
 * Proof line under the Upload button. It must come from the Evaluation page's real figures
 * (docs/EVALUATION.md, per docs/ARCHITECTURE.md §8). That page does not exist yet.
 * TODO(eval): set this to the measured figure, e.g. "N% of questions verified against their
 * cited page across X PDFs", and link it to the Evaluation page. While it is null the page
 * renders no proof line at all; nothing is invented.
 */
const EVAL_PROOF: string | null = null

interface Props {
  theme: Theme
  /** "Get started": opens the login modal on sign-up, then continues to the Library. */
  onCta: () => void
}

/** The storybook spread: copy on the left page, the live painted library framed on the right. */
export function Hero({ theme, onCta }: Props) {
  const dark = theme === 'dark'
  const reducedMotion = usePrefersReducedMotion()
  // null = follow the reduced-motion setting; true/false = the reader pressed Play/Pause
  const [choice, setChoice] = useState<boolean | null>(null)
  const running = choice ?? !reducedMotion
  const [webglFailed, setWebglFailed] = useState(false)

  const heroRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const plateRef = useRef<HTMLDivElement>(null)
  // the plate stays a clean painting until the reader asks for the sample question
  const [sampleOpen, setSampleOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const closeSample = () => {
    returnFocus.current = true
    setSampleOpen(false)
  }
  // after closing, hand focus back to the tab that opened the card (it re-mounts on close)
  useEffect(() => {
    if (!sampleOpen && returnFocus.current) {
      returnFocus.current = false
      triggerRef.current?.focus()
    }
  }, [sampleOpen])
  const sceneRef = useRef<StacksScene | null>(null)
  // the scene loads late, so it starts from whatever theme/play state is current by then
  const latest = useRef({ dark, running })
  useEffect(() => { latest.current = { dark, running } }, [dark, running])

  // Load three.js lazily, once the browser is idle, so the headline and CTA paint first.
  useEffect(() => {
    let cancelled = false
    let created: StacksScene | null = null
    const load = () =>
      import('../../scene/stacksScene')
        .then(({ StacksScene }) => {
          if (cancelled || !canvasRef.current || !heroRef.current || !plateRef.current) return
          created = new StacksScene(canvasRef.current, heroRef.current, plateRef.current, latest.current)
          sceneRef.current = created
        })
        .catch(() => { if (!cancelled) setWebglFailed(true) })
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(load, { timeout: 1200 })
      : window.setTimeout(load, 200)
    return () => {
      cancelled = true
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
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
            <h1>Quizzes from your PDFs, with the page for every answer.</h1>
            <p className="lede">
              Upload a textbook, a module or your lecture notes. Bookwyrm writes questions only from what is
              in it, checks each one, and shows you the page it came from.
            </p>
            <div className="actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={onCta}>
                Get started
                <ArrowRightIcon />
              </button>
              {EVAL_PROOF && <p className="proof">{EVAL_PROOF}</p>}
            </div>
          </div>
          <span className="folio" aria-hidden="true">— i —</span>
        </div>

        <div className="page page-r">
          <div className="page-r-paper" />
          <div className="plate-frame" ref={plateRef} />
          <span className="running" aria-hidden="true">Plate the First</span>
          <div className={`plate-card${sampleOpen ? ' is-open' : ''}`}>
            {sampleOpen ? (
              <SampleQuestionCard id="sample-question" onClose={closeSample} />
            ) : (
              <button
                type="button"
                className="sample-trigger"
                ref={triggerRef}
                aria-expanded="false"
                aria-controls="sample-question"
                onClick={() => setSampleOpen(true)}
              >
                <QuizIcon />
                Try a sample question
              </button>
            )}
          </div>
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

      <Link className="scroll-hint" to={{ hash: '#how' }}>
        How it works
        <ChevronDownIcon />
      </Link>
    </section>
  )
}
