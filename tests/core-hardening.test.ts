// Cases /verify found by attacking the pipeline: text that made checks run outside their deadline,
// and encoded secrets the decoder did not line up with. Each one leaked in a real run or a scratch run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { decodeLayers } from '../src/core/decoder.ts'
import { findPlaceholders } from '../src/core/placeholder.ts'
import { Redactor, NO_ALLOW } from '../src/core/session.ts'
import { resolveSettings } from '../src/core/settings.ts'

const KEY = ['ghp', 'Qw3rTy7UiOp9AsDf1GhJk5LzXc8VbNm2ZxCv'].join('_')
const PW = ['Har', 'bor', '4821', 'xkqz'].join('')
const b64 = (s: string): string => Buffer.from(s).toString('base64')
const hex = (s: string): string => Buffer.from(s).toString('hex')

const make = (): Redactor => new Redactor({ checker: createChecker({}).checker, registered: [], hints: true, allow: NO_ALLOW })
const run = (r: Redactor, text: string, ms = 20_000) => r.redactText(text, { deadline: performance.now() + ms })

function timed<T>(f: () => T): { value: T; ms: number } {
  const t0 = performance.now()
  const value = f()
  return { value, ms: performance.now() - t0 }
}

test('placeholders: an unclosed flood takes linear time, not quadratic', () => {
  const small = timed(() => findPlaceholders('[REDACTED:'.repeat(50_000))).ms
  const large = timed(() => findPlaceholders('[REDACTED:'.repeat(400_000))).ms
  assert.ok(large < 500, `4 MB took ${large} ms`)
  assert.ok(large < Math.max(small, 1) * 40, `8 times the text took ${large / Math.max(small, 0.01)} times as long`)
})

test('placeholders: a ] far past the end of any placeholder is not looked for', () => {
  const text = `${'[REDACTED:X '.repeat(100_000)}]`
  assert.ok(timed(() => findPlaceholders(text)).ms < 500)
})

test('a flood of placeholder starts cannot push a secret past the checks', () => {
  const text = `password=${PW}\n${KEY}\n${'[REDACTED:'.repeat(300_000)}`
  const { value: out, ms } = timed(() => run(make(), text))
  assert.ok(ms < 4000, `${ms} ms`)
  assert.equal(out.text.includes(PW), false)
  assert.equal(out.text.includes(KEY), false)
})

test('many spans over many placeholders stay fast', () => {
  const r = make()
  const lines: string[] = []
  for (let i = 0; i < 40_000; i++) lines.push(`password=[REDACTED:PASSWORD #${'abcdefghij234'}] and password=abc${i.toString(36).padStart(6, '0')}x`)
  const { value: out, ms } = timed(() => run(r, lines.join('\n')))
  assert.equal(out.complete, true)
  assert.ok(ms < 8000, `${ms} ms`)
})

for (const [name, text] of [
  ['1 character before', `a${b64(KEY)}`],
  ['2 characters before', `ab${b64(KEY)}`],
  ['3 characters before', `abc${b64(KEY)}`],
  ['a word and a dash', `id-${b64(KEY)}`],
  ['a word and an underscore', `tok_${b64(KEY)}`],
  ['a path of odd length', `/a/${b64(KEY)}`],
  ['a longer path', `https://host.example/v1/items/${b64(KEY)}`],
] as const) {
  test(`base64 glued to ${name} is decoded and hidden`, () => {
    const encoded = b64(KEY)
    const out = run(make(), text)
    assert.equal(out.text.includes(encoded.slice(4, -4)), false)
    assert.ok(out.hits.length > 0)
  })
}

test('a long run with a word in front still decodes at the right place', () => {
  const body = b64(`${'plain text that goes on and on '.repeat(40_000)}\n${KEY}\n`)
  const out = run(make(), `data-${body}`, 60_000)
  assert.equal(out.complete, true)
  assert.ok(out.hits.length > 0)
})

test('a large base64 block is not failed by the misaligned tries', () => {
  const body = Buffer.alloc(3 * 1024 * 1024, 'kj3').toString('base64')
  const { layers, complete } = decodeLayers(body, { deadline: performance.now() + 60_000 })
  assert.equal(complete, true)
  assert.equal(layers.length >= 1, true)
})

const blob = b64(`line one of text that goes on\n${'x'.repeat(200)}\n${KEY}\nend\n`)
const wrap = (w: number, nl: string): string => (blob.match(new RegExp(`.{1,${w}}`, 'g')) as string[]).join(nl)

for (const [name, text] of [
  ['indented with spaces', wrap(64, '\n    ')],
  ['indented with a tab', wrap(64, '\n\t')],
  ['indented, CRLF', wrap(64, '\r\n  ')],
  ['under a YAML key', `tls.key: |\n  ${wrap(64, '\n  ')}\n`],
] as const) {
  test(`wrapped base64 ${name} is hidden`, () => {
    assert.ok(run(make(), text).hits.length > 0)
  })
}

test('a secret that runs into a short last line of wrapped base64 is hidden', () => {
  const short = b64(`${'y'.repeat(24)}${KEY}`).match(/.{1,76}/g) as string[]
  assert.ok((short.at(-1) as string).length < 16, 'the last line is too short to be a run of its own')
  const out = run(make(), short.join('\n'))
  assert.ok(out.hits.length > 0)
  assert.equal(out.text.includes(short.at(-1) as string), false, 'the last line is covered')
})

test('hex is decoded whichever way its prefix lines up', () => {
  for (const lead of ['a', 'ab', 'abc', '0123f']) {
    const out = run(make(), `${lead}${hex(KEY)}`)
    assert.ok(out.hits.length > 0, lead)
  }
})

test('a short base64 password with non-ASCII letters passes the printable gate', () => {
  const value = `pässwörd${'4821zz'}`
  const out = run(make(), `x ${b64(`password=${value}`)} y`)
  assert.ok(out.hits.length > 0)
})

test('a value caught inside an encoded text is remembered as written, for its plain copy later', () => {
  const value = `pässwörd${'4821zz'}`
  const r = make()
  run(r, `x ${b64(`password=${value}`)} y`)
  assert.equal(run(r, `later ${value} end`).text.includes(value), false)
})

test('invalid UTF-8 in a short decoded run stays out', () => {
  const junk = Buffer.from([0xc3, 0x28, 0xa0, 0xa1, 0xe2, 0x28, 0xa1, 0xf0, 0x28, 0x8c, 0xbc, 0xff, 0xfe, 0x80, 0x81, 0x82, 0x83, 0x84]).toString('base64')
  assert.equal(decodeLayers(`x ${junk} y`, { deadline: performance.now() + 1000 }).layers.length, 0)
})

test('past the deadline the catch matcher is not rebuilt, and the result says so', () => {
  const r = make()
  run(r, `password=${PW}`)
  const out = r.redactText(`password=${PW}Z`, { deadline: performance.now() - 1 })
  assert.equal(out.complete, false)
})

test('a project can choose enforce over a user who turned on observe', () => {
  const r = resolveSettings({ user: { mode: 'observe' }, project: { mode: 'enforce' } })
  assert.equal(r.settings.mode, 'enforce')
})

test('a broken project source is ignored alone: it does not pin the last good settings', () => {
  const lastGood = resolveSettings({ user: { hints: 'off' } }).settings
  const r = resolveSettings({ policy: { on_check_failure: 'hold' }, project: { hints: 42 } }, { lastGood })
  assert.equal(r.settings.on_check_failure, 'hold')
  assert.equal(r.ok, false, 'the file is still reported as broken')
  assert.ok(r.errors.some(e => e.startsWith('project:')))
})

test('a value a rule blocks stays blocked when it is seen again, with its label or bare', () => {
  const r = new Redactor({ checker: createChecker({ actions: { 'github-pat': 'block' } }).checker, registered: [], hints: true, allow: NO_ALLOW })
  assert.equal(run(r, `first ${KEY}`).blocked, true)
  assert.equal(run(r, `again ${KEY}`).blocked, true)
  assert.equal(run(r, `in base64 ${b64(KEY)}`).blocked, true)
})

test('a blocked value still blocks after a worker restart', () => {
  const a = new Redactor({ checker: createChecker({ actions: { 'password-label': 'block' } }).checker, registered: [], hints: true, allow: NO_ALLOW })
  run(a, `password=${PW}`)
  const b = make()
  b.importCatches(a.exportCatches())
  assert.equal(run(b, `bare ${PW}`).blocked, true)
})

// A matcher build can't be interrupted, and a hook killed mid-build sends its whole row unhidden. So
// what the catch list may hold has to bound that build.

test('a value too long to remember is still hidden, but costs no matcher build', () => {
  const r = make()
  const key = ['-----BEGIN', 'RSA PRIVATE', 'KEY-----'].join(' ')
  const body = Buffer.from('some plain text that goes on and on\n'.repeat(40_000)).toString('base64')
  const { value: out, ms } = timed(() => run(r, `${key}\n${body}`))
  assert.ok(ms < 2000, `${ms} ms`)
  assert.equal(out.text.includes(body.slice(100, 200)), false, 'the block is hidden in this text')
  assert.ok(r.exportCatches().every(c => c.value.length <= 8192), 'and not remembered')
})

test('a private key of ordinary size is remembered', () => {
  const r = make()
  const key = ['-----BEGIN', 'RSA PRIVATE', 'KEY-----'].join(' ')
  const end = ['-----END', 'RSA PRIVATE', 'KEY-----'].join(' ')
  const body = Array.from({ length: 50 }, (_, i) => `${i}`.padStart(64, 'Qx7')).join('\n')
  run(r, `${key}\n${body}\n${end}`)
  assert.ok(r.exportCatches().some(c => c.value.length > 3000))
})

test('the catch list is capped by characters too, and the longest build stays short', () => {
  const r = make()
  const lines: string[] = []
  for (let i = 0; i < 40; i++) lines.push(`password=${String(i).padStart(4, '0')}${'Kq7'.repeat(2000)}`)
  const { value: out, ms } = timed(() => run(r, lines.join('\n')))
  assert.ok(ms < 3000, `${ms} ms`)
  assert.equal(out.capped, true)
  assert.ok(r.exportCatches().filter(c => c.caught).reduce((n, c) => n + c.value.length, 0) <= 100_000)
})

// What is kept for a restart has to fit in one $.state write. The host refuses more than 4,194,304
// characters of JSON (measured on 2.1.316, D-053), and values the catch list refused still get tags.

const STATE_LIMIT = 4_194_304
const longPassword = (i: number): string => `password=${String(i).padStart(4, '0')}${'Kq7'.repeat(2600)}`

function flood(r: Redactor, rows: number): void {
  for (let i = 0; i < rows; i++) run(r, longPassword(i))
}

test('what is kept for a restart fits the host limit, however many values were tagged', () => {
  const r = make()
  flood(r, 600)
  assert.ok(JSON.stringify(r.exportCatches()).length <= STATE_LIMIT)
})

test('a catch made after the tagged values pass the limit survives a restart', () => {
  const a = make()
  flood(a, 600)
  assert.equal(run(a, `password=${PW}`).text.includes(PW), false)
  const b = make()
  b.importCatches(JSON.parse(JSON.stringify(a.exportCatches())))
  assert.equal(run(b, `bare ${PW} here`).text.includes(PW), false)
})

test('a value the catch list refused keeps its tag across a restart while there is room', () => {
  const a = make()
  flood(a, 20)
  const refused = longPassword(19).slice('password='.length)
  const entry = a.exportCatches().find(c => c.value === refused)
  assert.equal(entry?.caught, false, 'the list was full by then')
  const b = make()
  b.importCatches(JSON.parse(JSON.stringify(a.exportCatches())))
  assert.equal(run(b, longPassword(19)).hits[0]?.tag, entry?.tag)
})

// Not remembering a long value is a known limit (spec §22). The person has to be told it happened.

const TOO_LONG = 'Kq7'.repeat(2731)
const AT_LIMIT = `${'Kq7'.repeat(2730)}Kq`

test('a value too long to remember says so, once', () => {
  const r = make()
  const first = run(r, `password=${TOO_LONG}`)
  assert.equal(first.text.includes(TOO_LONG), false, 'it is hidden where it was found')
  assert.equal(first.tooLong, true)
  assert.equal(first.capped, false, 'the list is not full')
  assert.equal(run(r, `password=${'Zm4'.repeat(2731)}`).tooLong, undefined, 'only warned about once')
})

test('a value at the limit is remembered, so there is nothing to say', () => {
  const r = make()
  const out = run(r, `password=${AT_LIMIT}`)
  assert.equal('tooLong' in out, false)
  assert.equal(r.exportCatches().filter(c => c.caught).length, 1)
})

test('a value too long to remember and blocked says so too', () => {
  const r = new Redactor({ checker: createChecker({ actions: { 'password-label': 'block' } }).checker, registered: [], hints: true, allow: NO_ALLOW })
  const out = run(r, `password=${TOO_LONG}`)
  assert.equal(out.blocked, true)
  assert.equal(out.tooLong, true)
})

test('a warned value is never remembered, whatever its length, so it says nothing', () => {
  const r = new Redactor({ checker: createChecker({ actions: { 'password-label': 'warn' } }).checker, registered: [], hints: true, allow: NO_ALLOW })
  assert.equal('tooLong' in run(r, `password=${TOO_LONG}`), false)
})
