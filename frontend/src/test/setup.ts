import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom lacks these browser APIs; the landing page and theme hook use them.
function mockMatchMedia(matches = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}
mockMatchMedia()

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver

// jsdom has <dialog> but not showModal()/close(); this stand-in only toggles `open` and fires `close`.
// (Browsers also trap focus and handle Esc; that part is the browser's job, not ours to test.)
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

// jsdom can't draw on a canvas and logs a warning each time something asks. Answer "no drawing
// support" quietly instead: the app already handles that (the 3D hero shows its painted fallback,
// the Ink-glyph Wyrm stops trying).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

// jsdom doesn't scroll; route changes call this
window.scrollTo = () => {}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/') // jsdom keeps the URL between tests; routes read it
  localStorage.clear()
  delete document.documentElement.dataset.theme
  mockMatchMedia()
})

export { mockMatchMedia }
