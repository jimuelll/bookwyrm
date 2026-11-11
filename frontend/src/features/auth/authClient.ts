// Frontend-only stand-ins for the auth API (docs/ARCHITECTURE.md §6). Nothing here talks to a server yet,
// and the "session" lives only in React state, so a reload logs you out.
// TODO(auth): replace with POST /auth/register, POST /auth/login and GET /auth/me.
// TODO(oauth): replace googleSignIn with a redirect to GET /auth/google.
import type { User } from './authContext'

export type EmailMode = 'login' | 'signup'

export class AuthError extends Error {}

export interface EmailCredentials {
  mode: EmailMode
  email: string
  password: string
}

/** Pretends the server accepted the credentials. The real check (and argon2 hashing) is server-side. */
export async function emailSignIn(creds: EmailCredentials): Promise<User> {
  return { email: creds.email.trim().toLowerCase() }
}

export async function googleSignIn(): Promise<User> {
  throw new AuthError("Google sign-in isn't connected yet. Use your email for now.")
}
