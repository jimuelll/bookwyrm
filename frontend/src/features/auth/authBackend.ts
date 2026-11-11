import type { User } from './authContext'

/**
 * Everything the app needs from an auth service. The real one is Supabase (supabaseBackend.ts);
 * tests use an in-memory fake (fakeBackend.ts). Keeping this boundary small means the UI never
 * imports Supabase directly, and tests never touch the network.
 */
export interface AuthBackend {
  /** The user from a saved session (so a reload keeps you logged in), or null. */
  getUser(): Promise<User | null>
  /** Called whenever the user changes (log in, log out, token refresh, another tab). Returns an unsubscribe. */
  onChange(listener: (user: User | null) => void): () => void

  /** Creates the account and emails a confirmation link that returns to `next` once confirmed. */
  signUp(email: string, password: string, next: string): Promise<void>
  signIn(email: string, password: string): Promise<User>
  /** Leaves the page for Google's sign-in; it comes back to /auth/callback and then `next`. */
  signInWithGoogle(next: string): Promise<void>
  resendConfirmation(email: string, next: string): Promise<void>
  /** Emails a link to /auth/reset. Succeeds whether or not the address has an account (no leaking who signed up). */
  sendPasswordReset(email: string): Promise<void>
  /** Turns the one-time `code` from an email or Google redirect into a session. */
  exchangeCode(code: string): Promise<User>
  updatePassword(password: string): Promise<void>
  signOut(): Promise<void>
  /** The current access token, for calling our own API with `Authorization: Bearer ...`. */
  getAccessToken(): Promise<string | null>
}

/** A failure with a message written for the person using the app. */
export class AuthError extends Error {
  /** e.g. 'email_not_confirmed', so the modal can offer to resend the confirmation email */
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

/**
 * Only allow a same-site path after login. A link like /auth/callback?next=https://evil.example
 * would otherwise send someone to another site right after they trust us (an "open redirect").
 */
export function safeNext(next: string | null | undefined, fallback = '/library'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
