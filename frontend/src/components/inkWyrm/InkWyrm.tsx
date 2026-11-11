import { useEffect, useRef } from 'react'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { drawWyrm, type WyrmColors, type WyrmMode } from './draw'

interface Props {
  /** slither = something is working; coil = waiting or empty */
  mode?: WyrmMode
  width: number
  height: number
  /** size of one dot cell in CSS px; smaller = finer engraving */
  cell?: number
  speed?: number
  /** When the wyrm is the only sign of what's happening, describe it; otherwise it's decoration. */
  label?: string
  className?: string
}

/** Colours come from CSS variables (tokens.css), so the wyrm follows day/night and can be re-inked locally. */
function readColors(el: HTMLElement): WyrmColors {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return { dot: v('--wyrm-dot', '#241a11'), dim: v('--wyrm-dim', '#8a6c45'), eye: v('--wyrm-eye', '#c2621f') }
}

/** The Ink-glyph Wyrm: the loading and waiting animation (docs/DESIGN.md §7). */
export function InkWyrm({ mode = 'slither', width, height, cell = 4, speed = 1, label, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const scratch = document.createElement('canvas')
    let colors = readColors(canvas)
    let raf = 0
    let visible = true
    let broken = false // no 2D canvas available (e.g. tests): stop trying
    const t0 = performance.now()

    const draw = (t: number) => {
      const ok = drawWyrm(canvas, scratch, { mode, width, height, cell, colors, dpr: Math.min(2, window.devicePixelRatio || 1) }, t * speed)
      if (!ok) broken = true
    }
    const loop = (now: number) => {
      raf = 0
      if (broken || !visible || document.hidden) return // fully stopped until it's worth drawing again
      draw((now - t0) / 1000)
      raf = requestAnimationFrame(loop)
    }
    const kick = () => {
      if (!raf && !broken && !reduced && visible && !document.hidden) raf = requestAnimationFrame(loop)
    }

    // re-ink when the theme flips
    const themeWatch = new MutationObserver(() => {
      colors = readColors(canvas)
      if (reduced) draw(1.3)
    })
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    if (reduced) {
      draw(1.3) // one calm frame: mid-stride, eye open
      return () => themeWatch.disconnect()
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      kick()
    })
    io.observe(canvas)
    document.addEventListener('visibilitychange', kick)
    kick()
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      themeWatch.disconnect()
      document.removeEventListener('visibilitychange', kick)
    }
  }, [mode, width, height, cell, speed, reduced])

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width, height, display: 'block' }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}
