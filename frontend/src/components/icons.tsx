// Line icons used across Bookwyrm. Decorative by default (aria-hidden); give the parent control the accessible name.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const WyrmMark = (p: P) => (
  <svg viewBox="0 0 32 32" {...base} strokeWidth={1.8} {...p}>
    <path d="M4 22c3-6 6 2 9-3s6 3 9-2c2-3 4-3 6-1" />
    <path d="M24 14l2-5M27 15l3-4" />
    <circle cx="25.5" cy="17.5" r="1" fill="currentColor" />
  </svg>
)
export const UploadIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={1.8} {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></svg>
)
export const MoonIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
)
export const SunIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="4.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
)
export const FileIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v4h4M9 13h6M9 17h4" /></svg>
)
export const QuizIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>
)
export const BookmarkIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M7 3h10v18l-5-4-5 4Z" /></svg>
)
export const ChevronDownIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M6 9l6 6 6-6" /></svg>
)
export const PauseIcon = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
)
export const PlayIcon = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}><path d="M7 5v14l12-7z" /></svg>
)
