// formsOf: every written form of a secret that the matcher must find (spec §7 check 5, §18 step 3).
// The leak kit's own needles (tools/leak-test/detect.ts) are the oracle: whatever the kit would
// call a leak, the matcher must be able to find.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formsOf, utf8Latin1 } from '../src/core/forms.ts'
import { needlesFor } from '../tools/leak-test/detect.ts'
import { makeFake, seededSource, FAKE_KINDS } from '../tools/test-sets/fakes.ts'

const texts = (v: string): string[] => formsOf(v).map(f => f.text)

test('every form the leak kit searches for is a form the matcher looks for', () => {
  const src = seededSource('forms-kit')
  for (const kind of FAKE_KINDS) {
    const fake = makeFake(kind, src)
    const have = new Set(texts(fake.value))
    for (const n of needlesFor('f', fake.value)) {
      // The kit searches upper-case hex as its own needle; the matcher folds case instead.
      const text = n.form === 'hex-upper' ? n.text.toLowerCase() : n.text
      assert.ok(have.has(text), `${kind}: missing form ${n.form}`)
    }
  }
})

test('plain is first, forms are unique, and none is empty', () => {
  const forms = formsOf('Autumn2026-xyz')
  assert.equal(forms[0]?.form, 'plain')
  assert.equal(forms[0]?.text, 'Autumn2026-xyz')
  assert.equal(new Set(forms.map(f => f.text)).size, forms.length)
  assert.ok(forms.every(f => f.text.length > 0))
})

test('a value that needs no escaping has no separate json or url form', () => {
  const names = formsOf('abcdefghij1234').map(f => f.form)
  assert.ok(!names.includes('json-escaped'))
  assert.ok(!names.includes('url'))
})

test('quotes, backslashes and newlines are escaped once and twice', () => {
  const v = 'a"b\\c\nd-efgh'
  const once = JSON.stringify(v).slice(1, -1)
  const twice = JSON.stringify(once).slice(1, -1)
  const t = texts(v)
  assert.ok(t.includes(once))
  assert.ok(t.includes(twice))
})

test('unicode: percent-encoded as utf-8, \\u escapes lower-case, and a binary form for decoded bytes', () => {
  const v = 'pässwörd-日本'
  const t = texts(v)
  assert.ok(t.includes(encodeURIComponent(v)))
  assert.ok(t.includes('p\\u00e4ssw\\u00f6rd-\\u65e5\\u672c'))
  assert.ok(t.includes(utf8Latin1(v)))
  assert.equal(utf8Latin1('abc'), 'abc')
  assert.equal(utf8Latin1('é').length, 2)
})

test('url forms: upper and lower case escapes, plus for a space, and the strict set', () => {
  const t = texts('a b/c!d(e)f')
  assert.ok(t.includes('a%20b%2Fc!d(e)f'))
  assert.ok(t.includes('a%20b%2fc!d(e)f'))
  assert.ok(t.includes('a+b%2Fc!d(e)f'))
  assert.ok(t.includes('a%20b%2Fc%21d%28e%29f'))
})

test('encoded forms shorter than 8 characters are not used (too many false matches)', () => {
  const forms = formsOf('abc')
  assert.deepEqual(forms.map(f => f.form), ['plain'])
  const longer = formsOf('abcdef')
  assert.ok(longer.some(f => f.form.startsWith('base64')))
  assert.ok(longer.filter(f => f.form !== 'plain').every(f => f.text.length >= 8))
})

test('base64 at 3 alignments with the edges trimmed', () => {
  const v = 'secret-value-123'
  const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
  const f = formsOf(v).filter(x => x.form.startsWith('base64-'))
  assert.equal(f.length, 3)
  // Embedded at each alignment, the core always appears in the base64 of the whole.
  for (const lead of ['', 'x', 'xy']) {
    const whole = b64(`${lead}${v}tail`)
    assert.ok(f.some(x => whole.includes(x.text)), `lead ${lead.length}`)
  }
  // The trimmed core is shorter than the plain encoding.
  assert.ok(f.every(x => x.text.length < b64(v).length + 2))
})

test('hex is flagged case-insensitive; everything else is exact', () => {
  const forms = formsOf('hello-world-xyz')
  assert.ok(forms.filter(f => f.form === 'hex').every(f => f.exact === false))
  assert.ok(forms.filter(f => f.form !== 'hex').every(f => f.exact === true))
})
