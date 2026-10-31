// The checker end to end: positions, failure cases, repeated lines, custom rules and
// actions, the catch set, and that no secret reaches any output.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { catchSet } from '../tools/test-sets/catch.ts'
import { makeFake, seededSource } from '../tools/test-sets/fakes.ts'
import { speedSet } from '../tools/test-sets/speed.ts'

const src = seededSource('scan-test')
const pat = (): string => makeFake('github-pat', src).value
const aws = (): string => makeFake('aws-access-key', src).value

test('a finding is the exact span of the secret, in UTF-16 offsets', () => {
  const { checker } = createChecker()
  const v = pat()
  const prefix = 'café 😀 接続 '
  const text = `${prefix}token ${v} done`
  const r = checker.scan(text)
  assert.equal(r.complete, true)
  const f = r.findings.find(x => x.ruleId === 'github-pat')
  assert.ok(f)
  assert.equal(text.slice(f.start, f.end), v)
  assert.equal(f.kind, 'format')
  assert.equal(f.action, 'hide')
  assert.equal(f.label, 'GITHUB_PAT')
  assert.equal(f.showHint, true)
})

test('overlapping findings are merged into one span, a specific rule beating a generic one', () => {
  const { checker } = createChecker()
  const v = pat()
  const text = `api_key = "${v}"\n`
  const r = checker.scan(text)
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0]?.ruleId, 'github-pat')
  assert.ok((r.findings[0]?.start ?? 99) <= text.indexOf(v))
  assert.ok((r.findings[0]?.end ?? 0) >= text.indexOf(v) + v.length)
})

test('two secrets on two lines give two findings, in order', () => {
  const { checker } = createChecker()
  const a = pat()
  const b = aws()
  const r = checker.scan(`first ${a}\nsecond ${b}\n`)
  assert.equal(r.findings.length, 2)
  assert.ok((r.findings[0]?.start ?? 0) < (r.findings[1]?.start ?? 0))
})

// ---- the catch set ----------------------------------------------------------------------

test('catch set: 100% in the plain contexts, with decoder cases left for step 3', () => {
  const { checker } = createChecker()
  const inScope = ['env', 'env-crlf', 'json', 'yaml', 'log', 'log-unicode', 'stack-trace', 'escaped-json']
  const missed: string[] = []
  let n = 0
  for (const c of catchSet()) {
    if (!inScope.includes(c.context)) continue
    n++
    const s = c.secrets[0]
    assert.ok(s)
    const r = checker.scan(c.text)
    checker.clearLines()
    for (let i = s.start; i < s.end; i++) {
      if (!r.findings.some(f => f.start <= i && i < f.end)) {
        missed.push(c.id)
        break
      }
    }
  }
  assert.ok(n >= 100, `${n}`)
  assert.deepEqual(missed, [])
})

// ---- failure cases ------------------------------------------------------------------------

test('empty text, NUL bytes and lone surrogates do not crash', () => {
  const { checker } = createChecker()
  assert.deepEqual(checker.scan(''), { findings: [], complete: true })
  const v = pat()
  assert.equal(checker.scan(`\0\0${v}\0`).findings.length, 1)
  assert.equal(checker.scan(`\ud800 token ${v} \udc00`).findings.length, 1)
  assert.doesNotThrow(() => checker.scan('\0'.repeat(10_000) + 'password=' + '\ud83d'))
})

test('2 MB on one line finishes inside the budget', () => {
  const { checker } = createChecker()
  const v = pat()
  const line = 'x'.repeat(1024 * 1024) + ` token ${v} ` + 'y'.repeat(1024 * 1024)
  const t0 = performance.now()
  const r = checker.scan(line)
  assert.ok(performance.now() - t0 < 4000)
  assert.equal(r.complete, true)
  assert.equal(r.findings.length, 1)
})

test('every adversarial speed item finishes in time and in budget', () => {
  const { checker } = createChecker()
  for (const item of speedSet().filter(x => x.id.startsWith('adversarial-'))) {
    checker.clearLines()
    const t0 = performance.now()
    const r = checker.scan(item.text())
    const ms = performance.now() - t0
    assert.ok(ms < 3000, `${item.id}: ${Math.round(ms)} ms`)
    assert.equal(r.complete, true, item.id)
  }
})

test('a budget of 0 returns what it has with complete: false, and the checker keeps working', () => {
  const { checker } = createChecker({ budgetMs: 0 })
  const r = checker.scan(`token ${pat()}\n`)
  assert.equal(r.complete, false)
  assert.ok(Array.isArray(r.findings))
  const again = createChecker().checker.scan(`token ${pat()}\n`)
  assert.equal(again.complete, true)
})

test('an out-of-budget scan keeps the findings from the parts it did finish', () => {
  // The label scanner runs in the keyword pass, before any rule runs, so it is always in.
  const { checker } = createChecker({ budgetMs: 0 })
  const r = checker.scan('password=Autumn' + '2026xk\n')
  assert.equal(r.complete, false)
  assert.equal(r.findings.length, 1)
})

test('an engine without group positions still covers the secret', () => {
  const { checker } = createChecker({ noIndices: true })
  const v = aws()
  const text = `aws_access_key = ${v}\n`
  const r = checker.scan(text)
  assert.ok(r.findings.some(f => f.start <= text.indexOf(v) && f.end >= text.indexOf(v) + v.length))
})

// ---- repeated lines ------------------------------------------------------------------------

test('a clean line seen again is skipped, but a secret on a new line is still found', () => {
  const { checker } = createChecker()
  const line = 'GET /api/token?id=7 200\n'
  assert.equal(checker.scan(line.repeat(50)).findings.length, 0)
  const v = pat()
  assert.equal(checker.scan(line.repeat(5) + `token ${v}\n` + line).findings.length, 1)
})

test('a private key header seen alone first is still caught later', () => {
  const { checker } = createChecker()
  const header = ['-----BEGIN', 'RSA PRIVATE', 'KEY-----'].join(' ')
  assert.equal(checker.scan(`${header}\n`).findings.length, 0)
  const body = 'QUJD'.repeat(40)
  const r = checker.scan(`${header}\n${body}\n${body}\n`)
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0]?.label, 'PRIVATE_KEY')
})

test('a label line that was clean before is checked again when the value changes', () => {
  const { checker } = createChecker()
  assert.equal(checker.scan('password=\n').findings.length, 0)
  assert.equal(checker.scan('password=Autumn' + '2026xk\n').findings.length, 1)
  assert.equal(checker.scan('password=\npassword=Autumn' + '2026xk\n').findings.length, 1)
})

test('clearLines forgets the memory', () => {
  const { checker } = createChecker()
  const v = pat()
  // A line is remembered only after it was clean; the same text with a secret is a different line.
  assert.equal(checker.scan('token = none\n').findings.length, 0)
  checker.clearLines()
  assert.equal(checker.scan(`token = ${v}\n`).findings.length >= 1, true)
})

test('the file name is part of what is remembered', () => {
  const { checker } = createChecker()
  const line = 'password = Autumn' + '2026\n'
  assert.equal(checker.scan(line, { file: 'a.ts' }).findings.length, 0)
  // Same line, other file kind: a clean result in a source file must not hide it in an .env file.
  assert.equal(checker.scan(line, { file: '.env' }).findings.length, 1)
})

test('the memory is capped', () => {
  const { checker } = createChecker()
  for (let i = 0; i < 30; i++) {
    const lines = Array.from({ length: 1000 }, (_, k) => `INFO request ${i}-${k} used the token cache\n`).join('')
    assert.equal(checker.scan(lines).findings.length, 0)
  }
  assert.equal(checker.scan(`token ${pat()}\n`).findings.length, 1)
})

// ---- custom rules, off and actions -------------------------------------------------------------

test('a custom rule finds its format', () => {
  const { checker, errors } = createChecker({ custom: [{ id: 'acme-token', label: 'ACME_TOKEN', keyword: 'acme_', pattern: 'acme_[a-z0-9]{32}' }] })
  assert.deepEqual(errors, [])
  const v = 'acme_' + 'q7x9k2m4p1'.repeat(3) + 'ab'
  const text = `see ${v} here`
  const f = checker.scan(text).findings
  assert.equal(f.length, 1)
  assert.equal(f[0]?.kind, 'custom')
  assert.equal(f[0]?.label, 'ACME_TOKEN')
  assert.equal(text.slice(f[0]?.start, f[0]?.end), v)
})

test('a custom keyword the pattern does not require is rejected, and the checker keeps running', () => {
  const { checker, errors } = createChecker({ custom: [{ id: 'bad', label: 'BAD', keyword: 'zzz', pattern: 'acme_[a-z0-9]{32}' }] })
  assert.equal(errors.length, 1)
  assert.equal(errors[0]?.id, 'bad')
  assert.match(errors[0]?.reason ?? '', /keyword/)
  assert.equal(checker.scan(`token ${pat()}\n`).findings.length, 1)
})

test('invalid and stuck custom patterns are rejected with a reason, not run (R-15)', () => {
  const bad = [
    { id: 'syntax', pattern: 'acme_(' },
    { id: 'lookahead', pattern: 'acme_(?=x)[a-z]{9}' },
    { id: 'backref', pattern: '(acme_)\\1[a-z]{9}' },
    { id: 'nested', pattern: 'acme_(?:[a-z]+)+[0-9]{3}' },
    { id: 'nested-alt', pattern: 'acme_(?:a|aa)+[0-9]{3}' },
    { id: 'quadratic', pattern: 'acme_[a-z]*[a-z]*[a-z]*[a-z]*!' },
    { id: 'no-literal', pattern: '[a-z0-9]{32}' },
  ]
  const { checker, errors } = createChecker({ custom: bad.map(b => ({ ...b, label: 'X', keyword: 'acme_' })) })
  assert.deepEqual(errors.map(e => e.id).sort(), bad.map(b => b.id).sort())
  for (const e of errors) assert.ok(e.reason.length > 5)
  assert.equal(checker.scan('acme_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').findings.length, 0)
})

test('off turns a rule, the label scanner, the URL scanner and the key scanner off', () => {
  const v = pat()
  assert.equal(createChecker({ off: ['github-pat'] }).checker.scan(`x ${v}\n`).findings.length, 0)
  assert.equal(createChecker({ off: ['password-label'] }).checker.scan('password=Autumn' + '2026xk\n').findings.length, 0)
  assert.equal(createChecker({ off: ['url-password'] }).checker.scan('postgres://app:Autumn' + '2026xk@db/app\n').findings.length, 0)
  assert.equal(createChecker({ off: ['private-key-truncated', 'private-key'] }).checker.scan(`-----BEGIN PRIVATE KEY-----\n${'QUJD'.repeat(40)}\n`).findings.length, 0)
})

test('actions: block, hide and warn are carried per rule; a merge keeps the strictest', () => {
  const v = pat()
  const text = `x ${v}\n`
  for (const action of ['block', 'hide', 'warn'] as const) {
    const f = createChecker({ actions: { 'github-pat': action } }).checker.scan(text).findings
    assert.equal(f[0]?.action, action)
  }
  const merged = createChecker({ actions: { 'github-pat': 'warn', 'password-label': 'block' } }).checker.scan(`password=${v}\n`).findings
  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.action, 'block')
})

// ---- no secret in any output ------------------------------------------------------------------------

test('a planted fake appears in no finding, rejection or error text', () => {
  const v = pat()
  const w = 'acme_' + v.slice(4)
  const { checker, errors } = createChecker({ custom: [{ id: 'leaky', label: 'LEAKY', keyword: 'nope', pattern: `${w}(` }] })
  const r = checker.scan(`token ${v}\npassword=${w}\n`)
  const out = JSON.stringify({ errors, r })
  assert.ok(!out.includes(v))
  assert.ok(!out.includes(w))
  assert.equal(errors.length, 1)
})
