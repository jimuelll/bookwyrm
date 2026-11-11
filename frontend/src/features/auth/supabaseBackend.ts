import { createClient, type AuthError as SupabaseAuthError, type SupabaseClient, type User as SupabaseUser } from '@supabase/supabase-js'
import { AuthError, type AuthBackend } from './authBackend'
import type { User } from './authContext'

const url = import.meta.env.VITE_SUPABASE_URL
// The publishable ("anon") key is meant to be public: it only allows what Row Level Security permits.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

let client: SupabaseClient | null = null

function supabase(): SupabaseClient {
  if (!url || !key) {
    throw new AuthError(
      "Login isn't set up yet: add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to frontend/.env.local.",
    )
  }
  client ??= createClient(url, key, {
    auth: {
      // PKCE: links carry a one-time code that only this browser can redeem, instead of tokens in the URL
      flowType: 'pkce',
      // we redeem the code ourselves on /auth/callback and /auth/reset, so it happens exactly once
      detectSessionInUrl: false,
      persistSession: true, // "stay logged in": the session is kept in localStorage
      autoRefreshToken: true,
    },
  })
  return client
}

const toUser = (u: SupabaseUser): User => ({ id: u.id, email: u.email ?? '' })

const callbackUrl = (next: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

// Supabase error codes -> messages in our voice (docs/DESIGN.md §10)
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong email or password.',
  email_not_confirmed: 'Confirm your email first. Open the link we sent you.',
  user_already_exists: 'An account with this email already exists. Log in instead.',
  weak_password: 'Choose a stronger password: at least 8 characters, not a common one.',
  over_email_send_rate_limit: 'Too many emails sent. Wait a minute and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
  email_address_invalid: 'That email address is not valid.',
  same_password: 'Choose a password different from your old one.',
}

function fail(error: SupabaseAuthError | null): void {
  if (!error) return
  const code = error.code ?? undefined
  throw new AuthError((code && MESSAGES[code]) || 'Something went wrong. Try again.', code)
}

export const supabaseBackend: AuthBackend = {
  async getUser() {
    if (!url || !key) return null
    const { data } = await supabase().auth.getSession()
    return data.session ? toUser(data.session.user) : null
  },

  onChange(listener) {
    if (!url || !key) return () => {}
    const { data } = supabase().auth.onAuthStateChange((_event, session) => listener(session ? toUser(session.user) : null))
    return () => data.subscription.unsubscribe()
  },

  async signUp(email, password, next) {
    const { error } = await supabase().auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl(next) } })
    fail(error)
  },

  async signIn(email, password) {
    const { data, error } = await supabase().auth.signInWithPassword({ email, password })
    fail(error)
    return toUser(data.user!)
  },

  async signInWithGoogle(next) {
    const { error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(next) } })
    fail(error)
  },

  async resendConfirmation(email, next) {
    const { error } = await supabase().auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl(next) } })
    fail(error)
  },

  async sendPasswordReset(email) {
    const { error } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/reset` })
    fail(error)
  },

  async exchangeCode(code) {
    const { data, error } = await supabase().auth.exchangeCodeForSession(code)
    fail(error)
    return toUser(data.user!)
  },

  async updatePassword(password) {
    const { error } = await supabase().auth.updateUser({ password })
    fail(error)
  },

  async signOut() {
    const { error } = await supabase().auth.signOut()
    fail(error)
  },

  async getAccessToken() {
    if (!url || !key) return null
    const { data } = await supabase().auth.getSession()
    return data.session?.access_token ?? null
  },
}
