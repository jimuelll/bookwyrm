import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'

const loginDialog = () => screen.queryByRole('dialog', { name: /log in|create your account/i })

async function openFromUpload() {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Upload a PDF' }))
  return user
}

describe('login gate', () => {
  it('asks a logged-out visitor to log in before uploading', async () => {
    await openFromUpload()
    expect(loginDialog()).toBeInTheDocument()
    expect(screen.getByText('You need an account to upload a PDF.')).toBeInTheDocument()
  })

  it('offers both Google and email sign-in', async () => {
    await openFromUpload()
    const dialog = loginDialog()!
    expect(within(dialog).getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Email')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Password')).toBeInTheDocument()
  })

  it('logs in with email, closes the modal and lets the next upload through', async () => {
    const user = await openFromUpload()
    await user.type(screen.getByLabelText('Email'), 'ana@school.edu')
    await user.type(screen.getByLabelText('Password'), 'hunter22')
    await user.click(within(loginDialog()!).getByRole('button', { name: 'Log in' }))

    expect(loginDialog()).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Upload a PDF' }))
    expect(loginDialog()).not.toBeInTheDocument()
  })

  it('shows Log out in the bar once logged in, and Log in again after logging out', async () => {
    const user = await openFromUpload()
    await user.type(screen.getByLabelText('Email'), 'ana@school.edu')
    await user.type(screen.getByLabelText('Password'), 'hunter22')
    await user.click(within(loginDialog()!).getByRole('button', { name: 'Log in' }))
    const nav = screen.getByRole('navigation', { name: 'Main' })

    await user.click(within(nav).getByRole('button', { name: 'Log out' }))

    expect(within(nav).getByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })

  it('refuses a sign-up password shorter than 8 characters', async () => {
    const user = await openFromUpload()
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    await user.type(screen.getByLabelText('Email'), 'ana@school.edu')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i)
    expect(loginDialog()).toBeInTheDocument()
  })

  it('says Google sign-in is not connected yet and stays logged out', async () => {
    const user = await openFromUpload()
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/google sign-in isn't connected yet/i)
    expect(loginDialog()).toBeInTheDocument()
  })

  it('closes without logging in when dismissed', async () => {
    const user = await openFromUpload()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(loginDialog()).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })
})
