// Reading `.env` files for `/redact learn`, and the limits on any registered value (spec §8).

import type { Checker } from '../checker/index.ts'

export type EnvEntry = { key: string; value: string; line: number }

/** Shorter would hide ordinary words; longer can't be kept in the matcher (D-052). */
export const MIN_REGISTERED = 6
export const MAX_REGISTERED = 8192
const MAX_ENTRIES = 2000
const MAX_LINE = 16_384
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]{0,127})\s*=\s*(.*)$/

function valueOf(raw: string): string {
  const t = raw.trim()
  const q = t[0]
  if (q === '"' || q === "'" || q === '`') {
    const end = t.indexOf(q, 1)
    return end > 0 ? t.slice(1, end) : t.slice(1)
  }
  const hash = t.search(/\s#/)
  return (hash >= 0 ? t.slice(0, hash) : t).trim()
}

export function parseEnv(text: string): EnvEntry[] {
  const out: EnvEntry[] = []
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0
  let line = 0
  while (at < text.length && out.length < MAX_ENTRIES) {
    let end = text.indexOf('\n', at)
    if (end < 0) end = text.length
    line++
    if (end - at <= MAX_LINE) {
      const m = LINE.exec(text.slice(at, end).replace(/\r$/, ''))
      if (m) {
        const value = valueOf(m[2] as string)
        if (value !== '') out.push({ key: m[1] as string, value, line })
      }
    }
    at = end + 1
  }
  return out
}

/** Why a value can't be registered, in a few words, or nothing. Never holds the value. */
export function validRegistered(value: string): string | undefined {
  if (value !== value.trim()) return 'has spaces at the ends'
  if (value.length < MIN_REGISTERED) return 'too short'
  if (value.length > MAX_REGISTERED) return 'too long'
  return undefined
}

/** A value the checker would hide where it stands starts ticked. A dotted file name makes it read as an env file. */
export function startsTicked(checker: Checker, key: string, value: string): boolean {
  if (validRegistered(value) !== undefined) return false
  return checker.scan(`${key}=${value}`, { file: '.env' }).findings.some(f => f.action !== 'warn')
}
