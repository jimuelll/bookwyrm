// The last display name we saw for an account, kept in this browser so pages can show it instantly
// instead of a stand-in while the API answers (which can take a while if the server was asleep).
// It's only a convenience: the API stays the source of truth and is checked on every visit.

const key = (userId: string) => `bookwyrm-display-name:${userId}`

export function readCachedName(userId: string | undefined): string | null {
  if (!userId) return null
  try {
    return localStorage.getItem(key(userId))
  } catch {
    return null // storage blocked (private mode, strict settings): just no cache
  }
}

export function writeCachedName(userId: string, name: string): void {
  try {
    localStorage.setItem(key(userId), name)
  } catch {
    /* no storage: the name still loads from the API */
  }
}

/** On log out, so the next person on a shared computer doesn't see it. */
export function clearCachedNames(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('bookwyrm-display-name:'))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* nothing stored */
  }
}
