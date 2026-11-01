// The overwrite guard and the placeholder notice (spec §10, R-11). Claude only saw the redacted file,
// so rewriting it can swap a real secret for its placeholder and lose the secret. A real value is
// never put back; the change is refused instead.

import { findPlaceholders } from './placeholder.ts'
import type { Redacted, RedactTextOptions } from './session.ts'

/** What the guard needs of a Redactor. */
export type GuardRedactor = {
  redactText(text: string, o: RedactTextOptions): Redacted
  valueOfTag(tag: string): string | undefined
}

/** The file's text after an Edit, or undefined when `old` isn't in it (the Edit then fails by itself). */
export function applyEdit(disk: string, old: string, next: string, all: boolean): string | undefined {
  if (old === '' || !disk.includes(old)) return undefined
  return all ? disk.split(old).join(next) : disk.replace(old, () => next)
}

export type PlaceholderAt = { line: number; tag: string; label: string }

const parts = (text: string): { label: string; tag: string } => ({
  label: (/^\[REDACTED:([A-Z0-9_]+)/.exec(text) as RegExpExecArray)[1] as string,
  tag: (/#([a-z2-7]{13})\]$/.exec(text) as RegExpExecArray)[1] as string,
})

/** Each placeholder in the text, with its line, counted from 1. */
export function placeholdersIn(text: string): PlaceholderAt[] {
  const out: PlaceholderAt[] = []
  let line = 1
  let at = 0
  for (const [s, e] of findPlaceholders(text)) {
    for (let i = text.indexOf('\n', at); i >= 0 && i < s; i = text.indexOf('\n', i + 1)) line++
    at = s
    out.push({ line, ...parts(text.slice(s, e)) })
  }
  return out
}

export type OverwriteCheck = { path: string; disk: string; after: string; deadline: number }
export type OverwriteResult = { blocked: boolean; tags: string[]; complete: boolean }

/**
 * Blocked when a secret in the file on disk is gone from the new text and its placeholder is there.
 * A placeholder this session has no value for may come from an earlier session: same kind counts.
 */
export function checkOverwrite(r: GuardRedactor, c: OverwriteCheck): OverwriteResult {
  const scan = r.redactText(c.disk, { file: c.path, deadline: c.deadline })
  const secrets = scan.hits.filter(h => h.action !== 'warn')
  if (secrets.length === 0) return { blocked: false, tags: [], complete: scan.complete }
  const lost = new Map<string, string>()
  for (const h of secrets) {
    const value = r.valueOfTag(h.tag)
    if (value === undefined || !c.after.includes(value)) lost.set(h.tag, h.label)
  }
  const labels = new Set(lost.values())
  const tags = new Set<string>()
  for (const p of placeholdersIn(c.after)) {
    if (lost.has(p.tag)) tags.add(p.tag)
    else if (r.valueOfTag(p.tag) === undefined) {
      if (labels.has(p.label) && !c.disk.includes(`#${p.tag}]`)) for (const [tag, label] of lost) if (label === p.label) tags.add(tag)
    }
  }
  return { blocked: tags.size > 0, tags: [...tags], complete: scan.complete }
}
