// Redactor.redactText: the whole pipeline for one piece of text (spec §7 checks 3 to 5, §9, §18).
// Fakes are built at run time by the test sets, never written whole here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { Redactor, NO_ALLOW, type Allow } from '../src/core/session.ts'
import { findPlaceholders } from '../src/core/placeholder.ts'
import { needlesFor, holdsFake } from '../tools/leak-test/detect.ts'
import { catchSet } from '../tools/test-sets/catch.ts'
import { codeSet } from '../tools/test-sets/code.ts'
import { makeFake, seededSource } from '../tools/test-sets/fakes.ts'

const src = seededSource('core-redact')
const fake = (kind: Parameters<typeof makeFake>[0]): string => makeFake(kind, src).value
const GH = fake('github-pat')
const AWS = fake('aws-access-key')
const PW = 'Autumn' + '2026xk'

function make(o: Partial<ConstructorParameters<typeof Redactor>[0]> = {}): Redactor {
  const { checker } = createChecker({})
  return new Redactor({ checker, registered: [], hints: true, allow: NO_ALLOW, ...o })
}
const run = (r: Redactor, text: string, extra: { file?: string; ms?: number } = {}) =>
  r.redactText(text, { ...(extra.file ? { file: extra.file } : {}), deadline: performance.now() + (extra.ms ?? 20_000) })
const b64 = (s: string): string => Buffer.from(s).toString('base64')

test('empty text and text with nothing in it come back unchanged', () => {
  const r = make()
  assert.deepEqual(run(r, ''), { text: '', hits: [], complete: true, blocked: false, capped: false })
  const plain = 'The quick brown fox.\n'
  const out = run(r, plain)
  assert.equal(out.text, plain)
  assert.equal(out.hits.length, 0)
})

test('check 3: a registered secret is hidden in every written form', () => {
  const value = 'Zq7-registered-' + 'Kd93mLx'
  const r = make({ registered: [{ value, label: 'my token', added: '2026-10-31' }] })
  const forms = [
    value,
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value),
    Buffer.from(value).toString('hex'),
    Buffer.from(value).toString('hex').toUpperCase(),
    ...[0, 1, 2].map(n => b64('x'.repeat(n) + value + 'tail')),
  ]
  for (const form of forms) {
    const out = run(r, `before ${form} after`)
    assert.ok(!holdsFake(out.text, needlesFor('v', value)), `form ${form.slice(0, 12)}…`)
    assert.match(out.text, /\[REDACTED:MY_TOKEN( \.\.\.[A-Za-z0-9]{4})? #[a-z2-7]{13}\]/)
    assert.equal(out.hits[0]?.kind, 'registered')
  }
})

test('check 4: once caught, always caught, even bare and in another text', () => {
  const r = make()
  const first = run(r, `password=${PW}\n`)
  assert.ok(!first.text.includes(PW))
  const second = run(r, `later in the log: ${PW} appeared again`)
  assert.ok(!second.text.includes(PW))
  assert.equal(second.hits[0]?.kind, 'caught')
  assert.equal(second.hits[0]?.tag, first.hits[0]?.tag)
})

test('a value caught later in the same text hides the earlier bare copy too', () => {
  const r = make()
  const out = run(r, `seen first: ${PW}\nand then password=${PW}\n`)
  assert.ok(!out.text.includes(PW))
  assert.equal(findPlaceholders(out.text).length, 2)
})

test('check 5: a disguised copy of a caught value is hidden, and the placeholder keeps the same tag', () => {
  const r = make()
  const plain = run(r, `token ${GH} ok`)
  const tag = plain.hits[0]?.tag
  assert.ok(tag)
  for (const form of [b64(`x:${GH}`), Buffer.from(GH).toString('hex'), encodeURIComponent(`a b=${GH}`)]) {
    const out = run(r, `data=${form} end`)
    assert.ok(!holdsFake(out.text, needlesFor('g', GH)), form.slice(0, 10))
    assert.ok(out.hits.some(h => h.tag === tag), 'same tag')
  }
})

test('check 5: a secret the checker finds inside base64 is hidden, and the encoded characters that carry it are replaced', () => {
  const r = make()
  const encoded = b64(`key=${AWS} user=bob`)
  const out = run(r, `blob=${encoded}\n`)
  assert.ok(!holdsFake(out.text, needlesFor('a', AWS)))
  // Only the secret's own bytes go; the base64 either side (which decodes to "key=" and " user=bob") stays.
  assert.match(out.text, /^blob=[A-Za-z0-9+/]*\[REDACTED:[A-Z0-9_]+ #[a-z2-7]{13}\][A-Za-z0-9+/=]*\n$/)
  assert.equal(out.hits.length, 1)
})

test('a secret caught inside an encoded layer is then hidden in the clear too', () => {
  const r = make()
  const out = run(r, `blob=${b64(`k=${GH}`)}\nlater: ${GH}\n`)
  assert.ok(!out.text.includes(GH))
  assert.equal(findPlaceholders(out.text).length, 2)
})

test('redacting twice gives what redacting once gives', () => {
  const texts = [
    `password=${PW}\n`,
    `DB_PASSWORD="${PW}"\nkey ${GH}\n`,
    `Authorization: Bearer ${'Tk9' + 'xQ2mZ7vB4nL8cR1wY5dF3'}\n`,
    `postgres://app:${'Meadow' + '7731bq'}@db.internal:5432/app\n`,
    `blob=${b64(`k=${GH}`)}\n`,
  ]
  for (const text of texts) {
    const r = make()
    const once = run(r, text).text
    const twice = run(r, once).text
    assert.equal(twice, once, text.slice(0, 20))
    // A fresh redactor (a new session) also leaves placeholders alone.
    assert.equal(run(make(), once).text, once)
  }
})

test('an existing placeholder is never hidden again, and a hit wholly inside one is dropped', () => {
  const r = make()
  const first = run(r, `password=${PW}`).text
  assert.match(first, /^password=\[REDACTED:PASSWORD #[a-z2-7]{13}\]$/)
  const again = run(r, first)
  assert.equal(again.text, first)
  assert.equal(again.hits.length, 0)
})

test('line endings are kept (CRLF stays CRLF)', () => {
  const out = run(make(), `a=1\r\npassword=${PW}\r\nb=2\r\n`).text
  assert.match(out, /^a=1\r\npassword=\[REDACTED:PASSWORD #[a-z2-7]{13}\]\r\nb=2\r\n$/)
})

test('text around a hidden value is untouched, including surrogate pairs next to it', () => {
  const out = run(make(), `😀 日本語 token ${GH}😀é\n`).text
  assert.match(out, /^😀 日本語 token \[REDACTED:[A-Z0-9_]+ \.\.\.[A-Za-z0-9]{4} #[a-z2-7]{13}\]😀é\n$/)
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(out))
})

test('tags: the same value keeps its tag, different values differ, and a new session differs', () => {
  const r = make()
  const a1 = run(r, `x ${GH}`).hits[0]?.tag
  const a2 = run(r, `y ${GH} z`).hits[0]?.tag
  const b = run(r, `x ${AWS}`).hits[0]?.tag
  assert.equal(a1, a2)
  assert.notEqual(a1, b)
  assert.notEqual(run(make(), `x ${GH}`).hits[0]?.tag, a1)
})

test('hints: last 4 characters for values of 12 or more, never for password-label values, none with hints off', () => {
  const withHint = run(make(), `x ${GH}`).text
  assert.ok(withHint.includes(` ...${GH.slice(-4)} #`))
  const label = run(make(), `password=${PW}`).text
  assert.ok(!label.includes('...'))
  const off = run(make({ hints: false }), `x ${GH}`).text
  assert.ok(!off.includes('...'))
})

test('allow: an exact value or a pattern leaves a value visible and makes no hit', () => {
  const allow: Allow = { values: new Set([GH]), patterns: [/^Autumn2026[a-z]{2}$/] }
  const r = make({ allow })
  const text = `a ${GH}\npassword=${PW}\nkey ${AWS}\n`
  const out = run(r, text)
  assert.ok(out.text.includes(GH))
  assert.ok(out.text.includes(PW))
  assert.ok(!out.text.includes(AWS))
  assert.equal(out.hits.length, 1)
})

test('actions: warn leaves the value and reports it; block hides it and flags the text', () => {
  const warn = make({ checker: createChecker({ actions: { 'github-pat': 'warn' } }).checker })
  const w = run(warn, `x ${GH}`)
  assert.equal(w.text, `x ${GH}`)
  assert.equal(w.hits[0]?.action, 'warn')
  assert.equal(w.blocked, false)
  // A warned value is not caught, so it stays visible later too.
  assert.equal(run(warn, `again ${GH}`).text, `again ${GH}`)

  const block = make({ checker: createChecker({ actions: { 'github-pat': 'block' } }).checker })
  const b = run(block, `x ${GH}`)
  assert.equal(b.blocked, true)
  assert.ok(!b.text.includes(GH))
  assert.equal(b.hits[0]?.action, 'block')
})

test('the catch cap stops new catches, says so once, and keeps hiding the ones it has', () => {
  const r = make({ maxCatches: 2 })
  const values = [fake('github-pat'), fake('gitlab-pat'), fake('npm')]
  const results = values.map(v => run(r, `k ${v}`))
  assert.deepEqual(results.map(x => x.capped), [false, false, true])
  assert.ok(!results[2]?.text.includes(values[2] as string), 'the checker still hides it by its shape')
  const later = run(r, `bare ${values[2]} and ${values[0]}`)
  assert.equal(later.capped, false, 'only warned about once')
  assert.ok(!later.text.includes(values[0] as string))
})

test('catches survive a restart: export, then import into a new redactor', () => {
  const r = make({ registered: [{ value: 'registered-' + 'Xy12ab9Qz', label: 'reg', added: '2026-10-31' }] })
  const first = run(r, `password=${PW}\n and registered-Xy12ab9Qz`)
  const saved = JSON.parse(JSON.stringify(r.exportCatches()))
  const revived = make({ registered: [{ value: 'registered-' + 'Xy12ab9Qz', label: 'reg', added: '2026-10-31' }] })
  revived.importCatches(saved)
  const again = run(revived, `bare: ${PW} and registered-Xy12ab9Qz`)
  assert.ok(!again.text.includes(PW))
  assert.deepEqual(new Set(again.hits.map(h => h.tag)), new Set(first.hits.map(h => h.tag)))
})

test('past the deadline the registered and caught values are still hidden, and the result says it is incomplete', () => {
  const r = make({ registered: [{ value: 'registered-' + 'Xy12ab9Qz', label: 'reg', added: '2026-10-31' }] })
  const out = r.redactText(`a registered-Xy12ab9Qz b ${GH}`, { deadline: performance.now() - 1 })
  assert.equal(out.complete, false)
  assert.ok(!out.text.includes('registered-Xy12ab9Qz'))
})

test('a 10 MB text stays inside its deadline', () => {
  const line = '2026-10-31T12:00:00.000Z INFO  [worker-3] request id=12345 status=200 took=17ms path=/api/v1/items/12345\n'
  const text = line.repeat(Math.ceil((10 * 1024 * 1024) / line.length)) + `token ${GH}\n`
  const t0 = performance.now()
  const out = run(make(), text, { ms: 4000 })
  const took = performance.now() - t0
  assert.ok(took < 6000, `${took.toFixed(0)} ms`)
  assert.ok(!out.text.includes(GH) || out.complete === false)
})

test('the code set: harmless text is left alone, and each twin is hidden', () => {
  const real = ['Autumn' + '2026xk', 'Meadow' + '7731bq']
  for (const c of codeSet()) {
    const r = make()
    assert.equal(run(r, c.text).text, c.text, `${c.id} was changed`)
    const v = c.id === 'documented-example-key' ? 'AK' + 'IA' + 'ZQ7XKMN4HTW3PBDC' : (real[0] as string)
    const twin = c.twin(v)
    assert.ok(!run(make(), twin).text.includes(v), `${c.id}: the twin was not hidden`)
  }
})

// Three cases put only a bare value in base64: a random string, a password and a hex-like key, with
// no label, URL or key shape around them. Nothing can tell those from any other base64, so they are
// the shapeless secrets of spec §22. The plan said all 138; the measured figure is 135 (progress, Known issues).
const SHAPELESS = ['jfrog/base64', 'connection-string/base64', 'labelled-password/base64']

test('the catch set: 135 of 138 cases are covered, and the only misses are the 3 shapeless base64 ones', () => {
  const cases = catchSet()
  assert.equal(cases.length, 138)
  const missed: string[] = []
  for (const c of cases) {
    const r = make()
    const out = run(r, c.text)
    const secret = c.secrets[0]!
    if (holdsFake(out.text, needlesFor(c.id, secret.value))) missed.push(c.id)
  }
  assert.deepEqual(missed.sort(), [...SHAPELESS].sort())
})
