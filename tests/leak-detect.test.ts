// The kit's search (tools/leak-test/detect.ts). A miss here is a false "clean",
// so every form a fake can take in a request has its own test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { holdsFake, needlesFor, scanRequest, scrub, witnessNeedle, type RequestView } from '../tools/leak-test/detect.ts'
import { makeFake, randomSource } from '../tools/test-sets/fakes.ts'

const src = randomSource()
const gh = () => makeFake('github-pat', src).value

const view = (body: unknown, extra: Partial<RequestView> = {}): RequestView => ({
  method: 'POST',
  url: '/v1/messages?beta=true',
  headers: { 'x-api-key': 'mock-not-a-key' },
  body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'),
  ...extra,
})

const forms = (v: RequestView, value: string) => scanRequest(v, needlesFor('f', value)).map(h => h.form)
const parts = (v: RequestView, value: string) => scanRequest(v, needlesFor('f', value)).map(h => h.part)

test('finds a plain fake in messages', () => {
  const value = gh()
  const v = view({ messages: [{ role: 'user', content: `here ${value} there` }] })
  assert.deepEqual([...new Set(forms(v, value))], ['plain'])
  assert.deepEqual([...new Set(parts(v, value))], ['messages'])
})

test('names the part: system, tools, messages, other, url and headers', () => {
  const value = gh()
  assert.deepEqual(parts(view({ system: [{ type: 'text', text: value }] }), value), ['system'])
  assert.deepEqual(parts(view({ tools: [{ name: 'x', description: value }] }), value), ['tools'])
  assert.deepEqual(parts(view({ metadata: { user_id: value } }), value), ['other'])
  assert.deepEqual(parts(view({}, { url: `/v1/x?k=${value}` }), value), ['url'])
  assert.deepEqual(parts(view({}, { headers: { 'x-note': value } }), value), ['headers'])
})

test('a body that is not JSON is still searched', () => {
  const value = gh()
  assert.deepEqual(parts(view(`plain text ${value}`), value), ['other'])
})

test('finds a value with quotes, backslashes and newlines: raw body and decoded strings', () => {
  const value = 'pa"ss\\wo\nrd-Zq7x'
  const v = view({ messages: [{ role: 'user', content: `a ${value} b` }] })
  assert.ok(forms(v, value).includes('plain'), 'decoded string')
  assert.ok(forms(v, value).includes('json-escaped'), 'raw body')
})

test('finds a private key whose newlines were escaped into the text', () => {
  const key = makeFake('private-key', src).value
  const inText = JSON.stringify({ key })
  const v = view({ messages: [{ role: 'user', content: `file: ${inText}` }] })
  assert.ok(forms(v, key).includes('json-escaped'))
})

test('finds JSON escaped twice', () => {
  const key = makeFake('private-key', src).value
  const twice = JSON.stringify(JSON.stringify(key))
  const v = view({ messages: [{ role: 'user', content: `file: ${twice}` }] })
  assert.ok(forms(v, key).includes('json-escaped-twice'))
})

test('finds Unicode around a fake, and a non-ASCII fake written as \\u escapes', () => {
  const value = gh()
  assert.ok(forms(view({ messages: [`日本語 ${value} — ok ✓`] }), value).includes('plain'))
  const uni = 'pässwörd-日本語-Zq7x'
  const escaped = JSON.stringify({ messages: [uni] }).replace(/[^\x00-\x7f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  assert.ok(forms(view(escaped), uni).includes('plain'))
})

test('finds a fake on a CRLF line', () => {
  const value = gh()
  assert.ok(forms(view({ messages: [`a\r\nkey=${value}\r\nb`] }), value).includes('plain'))
})

test('finds base64 at all three alignments, whatever surrounds it', () => {
  const value = gh()
  const seen = new Set<string>()
  for (let lead = 0; lead < 6; lead++) {
    for (let trail = 0; trail < 3; trail++) {
      const wrapped = Buffer.concat([randomBytes(lead), Buffer.from(value), randomBytes(trail)])
      const got = forms(view({ messages: [wrapped.toString('base64')] }), value).filter(f => f.startsWith('base64-'))
      assert.equal(got.length, 1, `lead ${lead} trail ${trail}`)
      seen.add(got[0] ?? '')
    }
  }
  assert.deepEqual([...seen].sort(), ['base64-0', 'base64-1', 'base64-2'])
})

test('finds base64url at all three alignments', () => {
  // Bytes chosen to give + and / in plain base64, so the url form differs.
  const value = '\xfb\xff\xfe-Zq7x\xfb\xff\xfe-secret-value'
  for (let lead = 0; lead < 3; lead++) {
    const wrapped = Buffer.concat([Buffer.alloc(lead, 1), Buffer.from(value, 'utf8')]).toString('base64url')
    assert.ok(forms(view({ messages: [wrapped] }), value).includes(`base64url-${lead}`), `lead ${lead}`)
  }
})

test('finds URL-encoded and hex forms', () => {
  const value = 'pa ss/wo&rd=Zq7x'
  assert.ok(forms(view({ messages: [encodeURIComponent(value)] }), value).includes('url'))
  const hex = Buffer.from(value).toString('hex')
  assert.ok(forms(view({ messages: [hex] }), value).includes('hex'))
  assert.ok(forms(view({ messages: [hex.toUpperCase()] }), value).includes('hex-upper'))
})

test('a near miss is no hit: a value one character short, or changed', () => {
  const value = gh()
  assert.deepEqual(forms(view({ messages: [value.slice(0, -1)] }), value), [])
  assert.deepEqual(forms(view({ messages: [`${value.slice(0, -1)}!`] }), value), [])
})

test('the last-4 hint of spec §9 is no hit', () => {
  const value = gh()
  assert.deepEqual(forms(view({ messages: [`[REDACTED:GITHUB ...${value.slice(-4)} #k7q2m9x4p1]`] }), value), [])
})

test('each hit names its fake once per part and form', () => {
  const a = gh()
  const b = gh()
  const needles = [...needlesFor('a', a), ...needlesFor('b', b)]
  const hits = scanRequest(view({ messages: [a, a, a, b] }), needles)
  assert.deepEqual(hits, [
    { fakeId: 'a', part: 'messages', form: 'plain' },
    { fakeId: 'b', part: 'messages', form: 'plain' },
  ])
})

test('huge input: a 5 MB body is searched whole, in reasonable time', () => {
  const value = gh()
  const big = 'x'.repeat(5 * 1024 * 1024) + value
  const t0 = Date.now()
  const hits = forms(view({ messages: [big] }), value)
  assert.ok(hits.includes('plain'))
  assert.ok(Date.now() - t0 < 10_000)
})

test('a witness is searched in plain form only, under its own id', () => {
  const needle = witnessNeedle('door-1', 'witness-0123456789abcdef')
  assert.deepEqual(scanRequest(view({ messages: ['seen witness-0123456789abcdef here'] }), [needle]), [
    { fakeId: 'door-1', part: 'messages', form: 'plain' },
  ])
})

test('holdsFake and scrub work on every form, and name no value', () => {
  const value = gh()
  const needles = needlesFor('door.kind', value)
  const b64 = Buffer.from(value).toString('base64')
  assert.equal(holdsFake(`x ${value} y`, needles), true)
  assert.equal(holdsFake(`x ${b64} y`, needles), true)
  assert.equal(holdsFake('nothing here', needles), false)
  const clean = scrub(`x ${value} y ${b64}`, needles)
  assert.equal(holdsFake(clean, needles), false)
  assert.match(clean, /<fake:door\.kind>/)
})
