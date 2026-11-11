import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fillHeaders, headersFor, originOf, parseHeaders } from './csp.ts'

const ENV = { VITE_API_URL: 'https://api.bookwyrm.example/', VITE_SUPABASE_URL: 'https://abcd1234.supabase.co' }
const source = readFileSync(resolve(__dirname, 'public/_headers'), 'utf8')

function policy(env = ENV): Map<string, string[]> {
  const csp = headersFor(parseHeaders(fillHeaders(source, env)), '/library').find(([name]) => name === 'Content-Security-Policy')
  if (!csp) throw new Error('no Content-Security-Policy for /library')
  return new Map(csp[1].split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
}

describe('the deployed Content-Security-Policy', () => {
  it('lets the page talk only to itself, our API and Supabase', () => {
    expect(policy().get('connect-src')).toEqual(["'self'", 'https://api.bookwyrm.example', 'https://abcd1234.supabase.co'])
  })

  it('runs only our own scripts: no inline code, no eval, no other hosts', () => {
    const p = policy()
    expect(p.get('default-src')).toEqual(["'none'"])
    expect(p.get('script-src')).toEqual(["'self'"])
    expect([...p.values()].flat()).not.toContain("'unsafe-inline'")
    expect([...p.values()].flat()).not.toContain("'unsafe-eval'")
    expect(p.get('frame-ancestors')).toEqual(["'none'"])
    expect(p.get('base-uri')).toEqual(["'none'"])
  })

  it('applies to every page, along with the other security headers', () => {
    const names = headersFor(parseHeaders(fillHeaders(source, ENV)), '/').map(([name]) => name)
    expect(names).toEqual(expect.arrayContaining(['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options']))
  })

  it('allows what the app falls back to when a value is missing, and says so', () => {
    const warnings: string[] = []
    const csp = fillHeaders(source, {}, (w) => warnings.push(w))
    expect(csp).toContain("connect-src 'self' http://localhost:8000;") // the app's own default API URL
    expect(csp).not.toContain('__')
    expect(warnings).toEqual([expect.stringContaining('VITE_SUPABASE_URL is not set')])
  })

  it('fails the build on a value that isn’t an http(s) URL', () => {
    expect(() => fillHeaders(source, { ...ENV, VITE_API_URL: 'api.example' })).toThrow('VITE_API_URL is not a URL')
    expect(() => originOf('VITE_API_URL', 'javascript:alert(1)')).toThrow('must be http(s)')
  })

  it('keeps index.html free of inline scripts, which the policy would block', () => {
    const html = readFileSync(resolve(__dirname, 'index.html'), 'utf8')
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
  })
})
