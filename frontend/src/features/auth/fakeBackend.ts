import { AuthError, type AuthBackend } from './authBackend'
import type { User } from './authContext'

/**
 * An in-memory stand-in for Supabase, used by tests. It behaves like the real service where it
 * matters to the UI: sign-up needs email confirmation, wrong passwords fail, codes are one-time.
 */
export function createFakeBackend(options: { signedIn?: User } = {}) {
  const accounts = new Map<string, { password: string; confirmed: boolean; id: string }>()
  const listeners = new Set<(user: User | null) => void>()
  const codes = new Map<string, string>() // one-time code -> email
  let user: User | null = options.signedIn ?? null
  const sent: { kind: 'confirm' | 'reset'; email: string; next?: string }[] = []
  const googleRedirects: string[] = []

  const setUser = (next: User | null) => {
    user = next
    listeners.forEach((l) => l(next))
  }
  const sessionFor = (email: string) => ({ id: accounts.get(email)!.id, email })

  const backend: AuthBackend = {
    async getUser() {
      return user
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async signUp(email, password, next) {
      if (!accounts.has(email)) accounts.set(email, { password, confirmed: false, id: `u-${accounts.size + 1}` })
      sent.push({ kind: 'confirm', email, next })
    },
    async signIn(email, password) {
      const account = accounts.get(email)
      if (!account || account.password !== password) throw new AuthError('Wrong email or password.', 'invalid_credentials')
      if (!account.confirmed) throw new AuthError('Confirm your email first. Open the link we sent you.', 'email_not_confirmed')
      setUser(sessionFor(email))
      return sessionFor(email)
    },
    async signInWithGoogle(next) {
      googleRedirects.push(next)
    },
    async resendConfirmation(email, next) {
      sent.push({ kind: 'confirm', email, next })
    },
    async sendPasswordReset(email) {
      sent.push({ kind: 'reset', email })
    },
    async exchangeCode(code) {
      const email = codes.get(code)
      codes.delete(code)
      if (!email) throw new AuthError('This link has expired or was already used.', 'bad_code')
      accounts.get(email)!.confirmed = true
      setUser(sessionFor(email))
      return sessionFor(email)
    },
    async updatePassword(password) {
      if (!user) throw new AuthError('Your reset link has expired. Ask for a new one.')
      accounts.get(user.email)!.password = password
    },
    async signOut() {
      setUser(null)
    },
    async getAccessToken() {
      return user ? `token-for-${user.id}` : null
    },
  }

  return {
    backend,
    sent,
    googleRedirects,
    /** Test helper: an account that already exists (confirmed unless said otherwise). */
    addAccount(email: string, password: string, confirmed = true) {
      accounts.set(email, { password, confirmed, id: `u-${accounts.size + 1}` })
    },
    /** Test helper: the one-time code an emailed link for `email` would carry. */
    issueCode(email: string) {
      const code = `code-${codes.size + 1}`
      codes.set(code, email)
      return code
    },
    get user() {
      return user
    },
  }
}
