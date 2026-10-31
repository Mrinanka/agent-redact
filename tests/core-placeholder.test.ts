// Placeholders (spec §9): [REDACTED:<LABEL> ...<last4> #<tag>], with a 65-bit random tag.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanLabel, findPlaceholders, hintOf, newTag, placeholderText } from '../src/core/placeholder.ts'

const TAG = /^[a-z2-7]{13}$/

test('a tag is 13 base32 characters, 65 bits, taken from the random source given', () => {
  const asked: number[] = []
  const tag = newTag(n => {
    asked.push(n)
    return new Uint8Array(n).fill(0xff)
  })
  assert.match(tag, TAG)
  assert.equal(tag, '7'.repeat(13))
  assert.ok((asked[0] as number) * 8 >= 65, 'asked for at least 65 bits')
  assert.equal(newTag(n => new Uint8Array(n)), 'a'.repeat(13))
})

test('tags from the real source are random and well formed', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 2000; i++) {
    const t = newTag(n => crypto.getRandomValues(new Uint8Array(n)))
    assert.match(t, TAG)
    seen.add(t)
  }
  assert.equal(seen.size, 2000)
})

test('the last 4 characters show only for 12 or more, only plain letters and digits, and never for label values', () => {
  assert.equal(hintOf('abcdefghijkl0001', { on: true, allowed: true }), '0001')
  assert.equal(hintOf('abcdefghijk', { on: true, allowed: true }), undefined) // 11
  assert.equal(hintOf('abcdefghijkl', { on: true, allowed: true }), 'ijkl') // 12
  assert.equal(hintOf('abcdefghijkl0001', { on: false, allowed: true }), undefined)
  assert.equal(hintOf('abcdefghijkl0001', { on: true, allowed: false }), undefined)
})

test('a hint with odd characters is dropped', () => {
  for (const tail of ['a]b#', 'ab c', 'é123', 'a\nbc', '..ab', '0]01']) {
    assert.equal(hintOf(`abcdefghijkl${tail}`.slice(-16), { on: true, allowed: true }), undefined, tail)
  }
})

test('the label is cleaned to upper-case letters, digits and underscores', () => {
  assert.equal(cleanLabel('aws-access-token'), 'AWS_ACCESS_TOKEN')
  assert.equal(cleanLabel('  my key]#  '), 'MY_KEY')
  assert.equal(cleanLabel(''), 'SECRET')
  assert.equal(cleanLabel('x'.repeat(100)).length, 40)
  assert.equal(cleanLabel('日本語'), 'SECRET')
})

test('placeholder text has the spec §9 shape, with and without a hint', () => {
  assert.equal(placeholderText('AWS_KEY', '0001', 'k7q2m5x4p3abc'), '[REDACTED:AWS_KEY ...0001 #k7q2m5x4p3abc]')
  assert.equal(placeholderText('PASSWORD', undefined, 'k7q2m5x4p3abc'), '[REDACTED:PASSWORD #k7q2m5x4p3abc]')
})

test('findPlaceholders spots whole placeholders only', () => {
  const a = placeholderText('AWS_KEY', '0001', 'k7q2m5x4p3abc')
  const b = placeholderText('PASSWORD', undefined, 'aaaaaaaaaaaaa')
  const text = `x ${a} y password=${b}\n[REDACTED:BAD #short] [REDACTED:NOPE`
  const found = findPlaceholders(text)
  assert.deepEqual(found.map(([s, e]) => text.slice(s, e)), [a, b])
})

test('findPlaceholders handles an empty text and a bracket at the very end', () => {
  assert.deepEqual(findPlaceholders(''), [])
  assert.deepEqual(findPlaceholders('[REDACTED:'), [])
  assert.deepEqual(findPlaceholders('['.repeat(50_000)), [])
})
