/**
 * Build-time help for public/_headers, the response headers Cloudflare sends with the deployed site.
 *
 * The Content-Security-Policy in that file must name our API and our Supabase project, which differ per
 * deployment, and Cloudflare serves _headers as a static file (no variables). So the file holds
 * placeholders and this plugin replaces them in dist/_headers after `vite build`, from the same VITE_*
 * values the app is built with, so the policy always allows exactly what the bundle calls. A malformed
 * value fails the build. A missing one does what the app does: the API falls back to localhost:8000
 * (src/app/api.ts), and without a Supabase URL the app has no login, so Supabase is left out (warning).
 *
 * `vite preview` then serves dist/ with those headers, so the policy can be checked locally before a
 * deploy. `vite dev` does not: its hot-reload client injects inline scripts and styles a strict policy
 * would block.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv, type Plugin } from 'vite'

const PLACEHOLDERS = [
  // the same default as API_BASE in src/app/api.ts
  { placeholder: '__API_ORIGIN__', name: 'VITE_API_URL', fallback: 'http://localhost:8000' },
  { placeholder: '__SUPABASE_ORIGIN__', name: 'VITE_SUPABASE_URL', fallback: null },
] as const

/** "https://abc.supabase.co/" -> "https://abc.supabase.co". A CSP source is an origin, not a URL. */
export function originOf(name: string, url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${name} is not a URL: ${url}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`${name} must be http(s): ${url}`)
  return parsed.origin
}

/** Replace the placeholders in a _headers file with the origins from `env`. */
export function fillHeaders(
  text: string,
  env: Record<string, string | undefined>,
  warn: (message: string) => void = () => {},
): string {
  let out = text
  for (const { placeholder, name, fallback } of PLACEHOLDERS) {
    const url = env[name] || fallback
    if (url) {
      out = out.replaceAll(placeholder, originOf(name, url))
    } else {
      warn(`${name} is not set, so the Content-Security-Policy doesn't allow it (and the app has no login).`)
      out = out.replaceAll(` ${placeholder}`, '')
    }
  }
  return out
}

export interface HeaderRule {
  pattern: string
  headers: [string, string][]
}

/** Parse Cloudflare's _headers format: a path pattern, then indented "Name: value" lines; # comments. */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] })
      continue
    }
    const colon = line.indexOf(':')
    if (colon > 0 && rules.length) rules[rules.length - 1].headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()])
  }
  return rules
}

/** The headers for one request path. Only the two pattern kinds we use: exact, and a trailing "*". */
export function headersFor(rules: HeaderRule[], path: string): [string, string][] {
  return rules
    .filter(({ pattern }) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern))
    .flatMap((rule) => rule.headers)
}

export function deployHeaders(): Plugin {
  let outDir = 'dist'
  let env: Record<string, string> = {}
  return {
    name: 'bookwyrm-deploy-headers',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      // the .env files plus VITE_* environment variables (those win), as the app itself sees them
      env = loadEnv(config.mode, config.envDir || config.root, 'VITE_')
    },
    writeBundle() {
      // runs after Vite copied public/_headers into dist/
      const file = resolve(outDir, '_headers')
      writeFileSync(file, fillHeaders(readFileSync(file, 'utf8'), env, (message) => this.warn(message)))
    },
    configurePreviewServer(server) {
      const rules = parseHeaders(readFileSync(resolve(outDir, '_headers'), 'utf8'))
      server.middlewares.use((req, res, next) => {
        for (const [name, value] of headersFor(rules, (req.url ?? '/').split('?')[0])) res.setHeader(name, value)
        next()
      })
    },
  }
}
