/** Small helpers for the shelf's rows (kept apart from BookRow.tsx so fast refresh works). */

// the hero's leathers; a book keeps the same binding every visit (picked from its id)
const BINDINGS = ['is-oxblood', 'is-green', 'is-navy'] as const
export function bindingFor(id: string) {
  let sum = 0
  for (const ch of id) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0
  return BINDINGS[sum % BINDINGS.length]
}

/** "added today", "added yesterday", "added 3 Nov", "added 3 Nov 2025" */
export function addedLabel(iso: string, now = new Date()) {
  const date = new Date(iso)
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(date)) / 86_400_000)
  if (days <= 0) return 'added today'
  if (days === 1) return 'added yesterday'
  const sameYear = date.getFullYear() === now.getFullYear()
  return `added ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}`
}
