import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'

const loginDialog = () => screen.queryByRole('dialog', { name: /log in|create your account/i })
const nav = () => screen.getByRole('navigation', { name: 'Main' })

async function openFromGetStarted() {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Get started' }))
  return user
}

async function signUp(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'ana@school.edu')
  await user.type(screen.getByLabelText('Password'), 'hunter22')
  await user.click(within(loginDialog()!).getByRole('button', { name: 'Create account' }))
}

describe('login gate', () => {
  it('Get started opens the modal on sign-up and says why', async () => {
    await openFromGetStarted()
    expect(screen.getByRole('dialog', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.getByText('Create an account to turn your PDFs into quizzes.')).toBeInTheDocument()
  })

  it('offers both Google and email sign-in', async () => {
    await openFromGetStarted()
    const dialog = loginDialog()!
    expect(within(dialog).getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Email')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Password')).toBeInTheDocument()
  })

  it('signing up closes the modal and continues to the library', async () => {
    const user = await openFromGetStarted()
    await signUp(user)
    expect(loginDialog()).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Your library' })).toBeInTheDocument()
  })

  it('refuses a sign-up password shorter than 8 characters', async () => {
    const user = await openFromGetStarted()
    await user.type(screen.getByLabelText('Email'), 'ana@school.edu')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i)
    expect(loginDialog()).toBeInTheDocument()
  })

  it('says Google sign-in is not connected yet and stays logged out', async () => {
    const user = await openFromGetStarted()
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/google sign-in isn't connected yet/i)
    expect(loginDialog()).toBeInTheDocument()
  })

  it('closes without logging in when dismissed', async () => {
    const user = await openFromGetStarted()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(loginDialog()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })

  it('the bar Log in opens the modal on the log-in form', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.getByRole('dialog', { name: 'Log in' })).toBeInTheDocument()
  })
})

describe('header', () => {
  it('shows Home, About and Log in when logged out, and no Upload', () => {
    render(<App />)
    expect(within(nav()).getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(within(nav()).getByRole('link', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upload a pdf/i })).not.toBeInTheDocument()
  })

  it('shows Library, Upload a PDF and the account menu once logged in', async () => {
    const user = await openFromGetStarted()
    await signUp(user)
    expect(within(nav()).getByRole('link', { name: 'Library' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload a PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Log in' })).not.toBeInTheDocument()
  })

  it('logs out from the account menu and returns to the start page', async () => {
    const user = await openFromGetStarted()
    await signUp(user)

    await user.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByText('ana@school.edu')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('button', { name: 'Get started' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })

  it('marks the current page in the bar', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(within(nav()).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

    await user.click(within(nav()).getByRole('link', { name: 'About' }))

    await screen.findByRole('heading', { level: 1, name: 'What Bookwyrm does' })
    expect(within(nav()).getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })
})

describe('pages', () => {
  it('About explains the four features', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(within(nav()).getByRole('link', { name: 'About' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'What Bookwyrm does' })).toBeInTheDocument()
    for (const name of ['Two ways to study', 'Know what to study next', 'Quiz your class', 'Every answer has a page']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
  })

  it('the Library asks a logged-out visitor to log in', () => {
    window.history.pushState(null, '', '/library')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Log in to see your library' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your library' })).not.toBeInTheDocument()
  })
})
