// `/redact self-check` (spec §15, §20): built-in cases on a throwaway Redactor, so the session's own
// catches are never touched. The fakes are joined at run time and random, and never reach a result.

import type { Checker } from '../checker/index.ts'
import { now } from './decoder.ts'
import { base64Encode, utf8 } from './forms.ts'
import { checkOverwrite } from './guard.ts'
import { NO_ALLOW, Redactor } from './session.ts'

export type CheckResult = { name: string; pass: boolean }
export type ReportInfo = { version: string; engine: string; os: string; date: string }

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function random(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('')
}

export function runSelfCheck(makeChecker: () => Checker): CheckResult[] {
  const github = ['ghp', random(36)].join('_')
  const password = ['Harbor', random(8), '7x'].join('')
  const own = ['acme', random(12)].join('-')
  const results: CheckResult[] = []
  const check = (name: string, run: (r: Redactor) => boolean): void => {
    try {
      const r = new Redactor({ checker: makeChecker(), registered: [{ value: own, label: 'self check', added: '2026-11-01' }], hints: true, allow: NO_ALLOW })
      results.push({ name, pass: run(r) })
    } catch {
      results.push({ name, pass: false })
    }
  }
  const clean = (r: Redactor, text: string): string => r.redactText(text, { deadline: now() + 2000 }).text
  check('a known key format is hidden', r => !clean(r, `key ${github} end`).includes(github))
  check('a password after a label is hidden', r => !clean(r, `password=${password}`).includes(password))
  check('a registered value is hidden', r => !clean(r, `value ${own} end`).includes(own))
  check('a caught value stays hidden without its label', r => {
    clean(r, `password=${password}`)
    return !clean(r, `later ${password}`).includes(password)
  })
  check('a value in base64 is hidden', r => {
    const encoded = base64Encode(utf8(`token ${github}`), false)
    return !clean(r, `data ${encoded} end`).includes(encoded)
  })
  check('a value in JSON is hidden', r => !clean(r, JSON.stringify({ password })).includes(password))
  check('ordinary code is left alone', r => {
    const code = 'const password = getPassword()\nfunction token(): string { return x }\n'
    return clean(r, code) === code
  })
  check('the same value gets the same tag', r => {
    const a = r.redactText(github, { deadline: now() + 2000 }).hits[0]?.tag
    const b = r.redactText(`again ${github}`, { deadline: now() + 2000 }).hits[0]?.tag
    return a !== undefined && a === b
  })
  check('the outbound check sees a known value', r => r.findKnown(`curl -d ${own}`, now() + 2000).hits.length === 1)
  check('the overwrite guard stops a lost secret', r => {
    const disk = `token=${github}\n`
    return checkOverwrite(r, { path: 'self-check.env', disk, after: clean(r, disk), deadline: now() + 2000 }).blocked
  })
  return results
}

export function reportText(results: readonly CheckResult[], info: ReportInfo): string {
  const failed = results.filter(r => !r.pass).length
  return [
    'aegiscontext self-check',
    `date: ${info.date}`,
    `plugin: ${info.version}`,
    `Claude Code: ${info.engine}`,
    `system: ${info.os}`,
    `result: ${results.length - failed} of ${results.length} passed`,
    '',
    ...results.map(r => `${r.pass ? 'pass' : 'FAIL'}  ${r.name}`),
    '',
  ].join('\n')
}
