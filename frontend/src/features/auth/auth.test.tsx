import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import { createFakeBackend } from './fakeBackend'

const loginDialog = () => screen.queryByRole('dialog')
const nav = () => screen.getByRole('navigation', { name: 'Main' })
const ANA = { id: 'u-1', email: 'ana@school.edu' }

function setup(options: Parameters<typeof createFakeBackend>[0] = {}, path = '/') {
  window.history.pushState(null, '', path)
  const fake = createFakeBackend(options)
  const user = userEvent.setup()
  render(<App authBackend={fake.backend} />)
  return { fake, user }
}

async function fillIn(user: ReturnType<typeof userEvent.setup>, email: string, password?: string) {
  await user.type(screen.getByLabelText('Email'), email)
  if (password !== undefined) await user.type(screen.getByLabelText('Password'), password)
}

describe('sign up', () => {
  it('Get started opens the modal on sign-up and says why', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Get started' }))
    expect(screen.getByRole('dialog', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.getByText('Create an account to turn your PDFs into quizzes.')).toBeInTheDocument()
  })

  it('asks the new reader to confirm their email and leaves them logged out', async () => {
    const { user, fake } = setup()
    await user.click(await screen.findByRole('button', { name: 'Get started' }))
    await fillIn(user, 'ana@school.edu', 'hunter22')
    await user.type(screen.getByLabelText('Type it again'), 'hunter22')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(fake.sent).toEqual([{ kind: 'confirm', email: 'ana@school.edu', next: '/library' }])
    expect(fake.user).toBeNull()
  })

  it('refuses a password shorter than 8 characters', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Get started' }))
    await fillIn(user, 'ana@school.edu', 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i)
  })

  it('refuses two different passwords and creates no account', async () => {
    const { user, fake } = setup()
    await user.click(await screen.findByRole('button', { name: 'Get started' }))
    await fillIn(user, 'ana@school.edu', 'hunter22')
    await user.type(screen.getByLabelText('Type it again'), 'hunter23')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords are different.')
    expect(fake.sent).toEqual([])
  })

  it('the confirmation link logs the reader in and continues to the library', async () => {
    const fake = createFakeBackend()
    fake.addAccount('ana@school.edu', 'hunter22', false)
    window.history.pushState(null, '', `/auth/callback?code=${fake.issueCode('ana@school.edu')}&next=/library`)
    render(<App authBackend={fake.backend} />)

    expect(await screen.findByRole('heading', { level: 1, name: /ex libris/i })).toBeInTheDocument()
  })

  it('a used or expired link explains and offers to log in', async () => {
    setup({}, '/auth/callback?code=not-a-real-code&next=/library')
    expect(await screen.findByRole('heading', { name: /couldn't log you in/i })).toBeInTheDocument()
  })

  it('never redirects to another site after login', async () => {
    const fake = createFakeBackend()
    fake.addAccount('ana@school.edu', 'hunter22', false)
    window.history.pushState(null, '', `/auth/callback?code=${fake.issueCode('ana@school.edu')}&next=//evil.example`)
    render(<App authBackend={fake.backend} />)

    await screen.findByRole('heading', { level: 1, name: /ex libris/i })
    expect(window.location.pathname).toBe('/library')
  })
})

describe('log in', () => {
  async function openLogin() {
    const ctx = setup()
    ctx.fake.addAccount('ana@school.edu', 'hunter22')
    await ctx.user.click(await screen.findByRole('button', { name: 'Get started' }))
    await ctx.user.click(within(loginDialog()!).getByRole('button', { name: 'Log in' }))
    return ctx
  }

  it('offers both Google and email', async () => {
    await openLogin()
    const dialog = loginDialog()!
    expect(within(dialog).getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Email')).toBeInTheDocument()
  })

  it('logs in with the right password and continues to the library', async () => {
    const { user } = await openLogin()
    await fillIn(user, 'ana@school.edu', 'hunter22')
    await user.click(within(loginDialog()!).getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('heading', { level: 1, name: /ex libris/i })).toBeInTheDocument()
    expect(loginDialog()).toBeNull()
  })

  it('says so when the password is wrong and stays logged out', async () => {
    const { user, fake } = await openLogin()
    await fillIn(user, 'ana@school.edu', 'wrong-password')
    await user.click(within(loginDialog()!).getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.')
    expect(fake.user).toBeNull()
  })

  it('offers to resend the link when the email is not confirmed yet', async () => {
    const { user, fake } = setup()
    fake.addAccount('ben@school.edu', 'hunter22', false)
    await user.click(await screen.findByRole('button', { name: 'Log in' }))
    await fillIn(user, 'ben@school.edu', 'hunter22')
    await user.click(within(loginDialog()!).getByRole('button', { name: 'Log in' }))

    await user.click(await screen.findByRole('button', { name: 'Resend the link' }))

    expect(fake.sent).toContainEqual({ kind: 'confirm', email: 'ben@school.edu', next: '/library' })
  })

  it('Continue with Google hands over to Google and asks to come back to the library', async () => {
    const { user, fake } = await openLogin()
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(fake.googleRedirects).toEqual(['/library'])
  })

  it('closes without logging in when dismissed', async () => {
    const { user, fake } = await openLogin()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(loginDialog()).toBeNull()
    expect(fake.user).toBeNull()
  })
})

describe('forgotten password', () => {
  it('sends a reset link without saying whether the account exists', async () => {
    const { user, fake } = setup()
    await user.click(await screen.findByRole('button', { name: 'Log in' }))
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    await fillIn(user, 'ana@school.edu')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText(/if there is an account for/i)).toBeInTheDocument()
    expect(fake.sent).toEqual([{ kind: 'reset', email: 'ana@school.edu' }])
  })

  it('the reset link lets the reader choose a new password', async () => {
    const fake = createFakeBackend()
    fake.addAccount('ana@school.edu', 'old-password')
    window.history.pushState(null, '', `/auth/reset?code=${fake.issueCode('ana@school.edu')}`)
    const user = userEvent.setup()
    render(<App authBackend={fake.backend} />)

    await user.type(await screen.findByLabelText('New password'), 'new-password-1')
    await user.type(screen.getByLabelText('Type it again'), 'new-password-1')
    await user.click(screen.getByRole('button', { name: 'Save password' }))

    expect(await screen.findByRole('heading', { level: 1, name: /ex libris/i })).toBeInTheDocument()
    await expect(fake.backend.signIn('ana@school.edu', 'new-password-1')).resolves.toBeTruthy()
  })

  it('refuses two different passwords', async () => {
    const fake = createFakeBackend()
    fake.addAccount('ana@school.edu', 'old-password')
    window.history.pushState(null, '', `/auth/reset?code=${fake.issueCode('ana@school.edu')}`)
    const user = userEvent.setup()
    render(<App authBackend={fake.backend} />)

    await user.type(await screen.findByLabelText('New password'), 'new-password-1')
    await user.type(screen.getByLabelText('Type it again'), 'new-password-2')
    await user.click(screen.getByRole('button', { name: 'Save password' }))

    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords are different.')
  })

  it('an expired reset link says to ask for a new one', async () => {
    setup({}, '/auth/reset?code=used-up')
    expect(await screen.findByRole('heading', { name: 'This reset link has expired' })).toBeInTheDocument()
  })
})

describe('header and session', () => {
  it('shows Home, About and Log in when logged out, and no Upload', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(within(nav()).getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(within(nav()).getByRole('link', { name: 'About' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upload a pdf/i })).not.toBeInTheDocument()
  })

  it('keeps a saved session: a reload shows the reader as logged in', async () => {
    setup({ signedIn: ANA }, '/about')
    expect(await within(nav()).findByRole('link', { name: 'Library' })).toBeInTheDocument()
    expect(within(nav()).getByRole('link', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload a PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Log in' })).not.toBeInTheDocument()
  })

  it('sends a logged-in reader from the start page to their Library', async () => {
    setup({ signedIn: ANA }, '/')
    expect(await screen.findByRole('heading', { level: 1, name: /ex libris/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/library')
  })

  it('shows Upload a PDF in the bar on every page once logged in', async () => {
    setup({ signedIn: ANA }, '/library')
    await screen.findByRole('heading', { level: 1, name: /ex libris/i })
    expect(screen.getByRole('button', { name: 'Upload a PDF' })).toBeVisible()
  })

  it('logs out from the account menu and returns to the start page', async () => {
    const { user, fake } = setup({ signedIn: ANA }, '/library')
    await user.click(await screen.findByRole('button', { name: 'Account' }))
    expect(screen.getByText('ana@school.edu')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('button', { name: 'Get started' })).toBeInTheDocument()
    expect(fake.user).toBeNull()
  })

  it('forgets the remembered display name on log out (shared computers)', async () => {
    localStorage.setItem('bookwyrm-display-name:u-1', 'Bookworm Ana')
    const { user } = setup({ signedIn: ANA }, '/library')
    await user.click(await screen.findByRole('button', { name: 'Account' }))
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await screen.findByRole('button', { name: 'Get started' })
    expect(localStorage.getItem('bookwyrm-display-name:u-1')).toBeNull()
  })

  it('marks the current page in the bar', async () => {
    const { user } = setup()
    expect(within(nav()).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')

    await user.click(within(nav()).getByRole('link', { name: 'About' }))

    await screen.findByRole('heading', { level: 1, name: 'What Bookwyrm does' })
    expect(within(nav()).getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('pages', () => {
  it('About explains the four features', async () => {
    setup({}, '/about')
    expect(await screen.findByRole('heading', { level: 1, name: 'What Bookwyrm does' })).toBeInTheDocument()
    for (const name of ['Two ways to study', 'Know what to study next', 'Quiz your class', 'Every answer has a page']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
  })

  it('the Library asks a logged-out visitor to log in', async () => {
    setup({}, '/library')
    expect(await screen.findByRole('heading', { level: 1, name: 'Log in to see your library' })).toBeInTheDocument()
  })
})
