import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { LandingPage } from './LandingPage'

// Smoke tests for the promises the landing page must keep. jsdom has no WebGL,
// so these also prove the page still works when the 3D scene can't start.
describe('LandingPage', () => {
  it('says what Bookwyrm does in the main heading', () => {
    render(<LandingPage />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(/uizzes from your PDFs, with the page for every answer/)
  })

  it('offers an Upload a PDF action', () => {
    render(<LandingPage />)
    expect(screen.getAllByRole('link', { name: /upload a pdf/i }).length).toBeGreaterThan(0)
  })

  it('has a pinned bar with navigation and a theme switch that works', async () => {
    render(<LandingPage />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const banner = nav.closest('header')!
    expect(banner).toBeInTheDocument()
    const toggle = within(banner).getByRole('button', { name: /switch to (day|night) mode/i })
    const before = document.documentElement.dataset.theme
    await userEvent.click(toggle)
    expect(document.documentElement.dataset.theme).not.toBe(before)
  })

  it('explains how it works in three steps', () => {
    render(<LandingPage />)
    const section = screen.getByRole('heading', { level: 2, name: /from your pdf to a quiz/i }).closest('section')!
    expect(within(section).getAllByRole('heading', { level: 3 })).toHaveLength(3)
  })
})
