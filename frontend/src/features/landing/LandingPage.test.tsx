import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'

// jsdom has no WebGL, so every test here also proves the page works when the 3D scene can't start.
describe('LandingPage', () => {
  it('has exactly one main heading with text in it', () => {
    render(<App />)
    // getByRole throws if there are zero or several h1s, so this also guards "one H1 per page"
    expect(screen.getByRole('heading', { level: 1 })).not.toBeEmptyDOMElement()
  })

  it('offers an Upload a PDF action', () => {
    render(<App />)
    expect(screen.getAllByRole('button', { name: /upload a pdf/i }).length).toBeGreaterThan(0)
  })

  it('switches from night to day mode and back to the opposite label', async () => {
    const user = userEvent.setup()
    render(<App />)
    // setup.ts mocks the OS as "not dark", so the page starts in day mode
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(screen.getByRole('button', { name: 'Switch to night mode' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: 'Switch to day mode' })).toBeInTheDocument()
  })

  it('"How it works" in the bar links to a section that exists', () => {
    render(<App />)
    const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'How it works' })
    const target = document.querySelector(link.getAttribute('href')!)
    expect(target).toBeInTheDocument()
    expect(within(target as HTMLElement).getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0)
  })
})

describe('sample question', () => {
  // the first fixture question: answer is "increase the surface area", cited on page 142
  const RIGHT = /increase the surface area/i
  const WRONG = /store glucose/i

  async function openSample() {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /try a sample question/i }))
    return user
  }

  it('opens from the trigger and moves focus onto the question', async () => {
    await openSample()
    expect(screen.getByRole('region', { name: /try a sample question/i })).toBeInTheDocument()
    expect(screen.getByText(/inner membrane of a mitochondrion/i)).toHaveFocus()
  })

  it('marks a right pick as correct', async () => {
    const user = await openSample()
    await user.click(screen.getByRole('button', { name: RIGHT }))
    expect(screen.getByText('Correct', { selector: '.verdict' })).toBeInTheDocument()
  })

  it('marks a wrong pick and still shows which answer was right', async () => {
    const user = await openSample()
    await user.click(screen.getByRole('button', { name: WRONG }))
    expect(screen.getByText('Not quite')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: WRONG })).getByText('Your pick')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: RIGHT })).getByText('Answer')).toBeInTheDocument()
  })

  it('keeps the first pick: a second click does not change the result', async () => {
    const user = await openSample()
    await user.click(screen.getByRole('button', { name: WRONG }))
    await user.click(screen.getByRole('button', { name: RIGHT }))
    expect(screen.getByText('Not quite')).toBeInTheDocument()
  })

  it('shows the cited source passage and page after answering', async () => {
    const user = await openSample()
    await user.click(screen.getByRole('button', { name: RIGHT }))

    await user.click(screen.getByRole('button', { name: /p\. 142/ }))

    const passage = screen.getByRole('blockquote', { hidden: false })
    expect(passage).toHaveTextContent(/greatly increase the surface area/i)
    expect(passage).toHaveTextContent(/page 142/)
  })

  it('moves to the next question and resets the answer', async () => {
    const user = await openSample()
    await user.click(screen.getByRole('button', { name: RIGHT }))

    await user.click(screen.getByRole('button', { name: /next question/i }))

    // the question prompt, not the hidden passage that also mentions the phrase
    expect(screen.getByText(/where in the chloroplast/i)).toBeInTheDocument()
    expect(screen.getByText('Pick an answer')).toBeInTheDocument()
  })

  it('closes on Escape and hands focus back to the trigger', async () => {
    const user = await openSample()

    await user.keyboard('{Escape}')

    const trigger = screen.getByRole('button', { name: /try a sample question/i })
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('region', { name: /try a sample question/i })).not.toBeInTheDocument()
  })
})
