// The catch, code, false-alarm and speed sets (plan 1b, 1c). Step 2 measures the
// checker against them, so these tests pin what each set promises.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CATCH_CONTEXTS, catchSet } from '../tools/test-sets/catch.ts'
import { codeSet } from '../tools/test-sets/code.ts'
import { falseAlarmFiles } from '../tools/test-sets/false-alarm.ts'
import { speedSet } from '../tools/test-sets/speed.ts'
import { FAKE_KINDS } from '../tools/test-sets/fakes.ts'

const root = path.join(import.meta.dirname, '..')

test('catch set: every format appears in every context', () => {
  const cases = catchSet()
  for (const kind of FAKE_KINDS) {
    for (const context of CATCH_CONTEXTS) {
      assert.ok(cases.some(c => c.format === kind && c.context === context), `${kind} in ${context}`)
    }
  }
  assert.ok(cases.length >= FAKE_KINDS.length * CATCH_CONTEXTS.length)
})

test('catch set: covers short human passwords', () => {
  const short = catchSet().filter(c => c.format === 'human-password')
  assert.ok(short.length >= 5)
  for (const c of short) assert.ok(c.secrets.every(s => s.value.length >= 6 && s.value.length <= 16), c.id)
})

test('catch set: ids are unique and every offset points exactly at the secret', () => {
  const cases = catchSet()
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length)
  for (const c of cases) {
    assert.ok(c.secrets.length > 0, c.id)
    for (const s of c.secrets) assert.equal(c.text.slice(s.start, s.end), s.shown, c.id)
  }
})

test('catch set: a secret is shown plainly or in its stated encoding', () => {
  for (const c of catchSet()) {
    for (const s of c.secrets) {
      if (s.encoding === 'plain') assert.equal(s.shown, s.value, c.id)
      if (s.encoding === 'base64') assert.equal(Buffer.from(s.shown, 'base64').toString('utf8'), s.value, c.id)
      if (s.encoding === 'json-escaped') assert.equal(JSON.parse(`"${s.shown}"`), s.value, c.id)
    }
  }
})

test('catch set: the same seed gives the same set, so scores compare across releases', () => {
  assert.deepEqual(catchSet(), catchSet())
  assert.notDeepEqual(catchSet('other-seed')[0]?.text, catchSet()[0]?.text)
})

test('catch set: CRLF and Unicode contexts really hold them', () => {
  const cases = catchSet()
  assert.ok(cases.filter(c => c.context === 'env-crlf').every(c => c.text.includes('\r\n')))
  assert.ok(cases.filter(c => c.context === 'log-unicode').every(c => /[^\x00-\x7f]/.test(c.text)))
})

test('code set: the spec 7.2 forms are all there and hold no fake', () => {
  const cases = codeSet()
  const texts = cases.map(c => c.text)
  for (const needed of ['password: string', 'token = getToken()', 'os.environ[', 'pass\n', '${VAR}', '{{ var }}', '${{ secrets.X }}', 'Optional[', 'process.env.X']) {
    assert.ok(texts.some(t => t.includes(needed)), needed)
  }
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length)
})

test('code set: each harmless form has a twin with a real-looking value in the same spot (R-08)', () => {
  for (const c of codeSet()) {
    const twin = c.twin('Zq7-real-looking-9x')
    assert.ok(twin.includes('Zq7-real-looking-9x'), c.id)
    assert.notEqual(twin, c.text, c.id)
  }
})

test('code set: the documented example key is built at run time and ends in EXAMPLE', () => {
  const c = codeSet().find(x => x.id === 'documented-example-key')
  assert.ok(c)
  assert.match(c.text, /EXAMPLE/)
})

test('false-alarm set: lists the pinned dev dependency .ts files, sorted, with relative names', () => {
  const files = falseAlarmFiles(root)
  assert.ok(files.length >= 100, `found ${files.length}`)
  assert.ok(files.every(f => f.name.endsWith('.ts')))
  assert.ok(files.every(f => !path.isAbsolute(f.name) && !f.name.includes('\\')))
  assert.deepEqual(files.map(f => f.name), files.map(f => f.name).sort())
  assert.ok(files.some(f => f.name.startsWith('typescript/')))
  assert.ok(files.some(f => f.name.startsWith('@types/node/')))
  assert.ok(fs.statSync(files[0]!.file).size > 0)
})

test('failure: false-alarm set says what to do when node_modules is missing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'false-alarm-'))
  try {
    assert.throws(() => falseAlarmFiles(empty), /npm ci/)
  } finally {
    fs.rmSync(empty, { recursive: true, force: true })
  }
})

test('speed set: names and exact sizes', () => {
  const set = speedSet()
  const size = (id: string) => {
    const item = set.find(x => x.id === id)
    assert.ok(item, id)
    return Buffer.byteLength(item.text(), 'utf8')
  }
  assert.equal(size('log-100k'), 100 * 1024)
  assert.equal(size('log-2m'), 2 * 1024 * 1024)
  assert.equal(size('json-one-line-2m'), 2 * 1024 * 1024)
  assert.equal(size('base64-block-2m'), 2 * 1024 * 1024)
  assert.ok(size('short') < 300)
})

test('speed set: the huge JSON is one line; logs are many lines', () => {
  const set = speedSet()
  assert.ok(!set.find(x => x.id === 'json-one-line-2m')?.text().includes('\n'))
  assert.ok((set.find(x => x.id === 'log-2m')?.text().split('\n').length ?? 0) > 1000)
})

test('speed set: the base64 block hides a secret near its middle', () => {
  const item = speedSet().find(x => x.id === 'base64-block-2m')
  assert.ok(item?.secret)
  const raw = Buffer.from(item.text(), 'base64').toString('latin1')
  const at = raw.indexOf(item.secret)
  assert.ok(at > raw.length * 0.4 && at < raw.length * 0.6, `at ${at} of ${raw.length}`)
})

test('speed set: 10,000 distinct registered secrets', () => {
  const item = speedSet().find(x => x.id === 'registered-10k')
  assert.ok(item?.registered)
  assert.equal(new Set(item.registered).size, 10_000)
})

test('speed set: holds inputs designed to slow patterns down', () => {
  const hard = speedSet().filter(x => x.id.startsWith('adversarial-'))
  assert.ok(hard.length >= 5)
  for (const h of hard) assert.ok(h.text().length >= 256 * 1024, h.id)
})

test('every set is deterministic: two runs give the same text', () => {
  const a = speedSet().map(x => x.text())
  const b = speedSet().map(x => x.text())
  assert.deepEqual(a, b)
})
