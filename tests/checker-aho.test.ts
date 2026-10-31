// Aho-Corasick keyword search (src/checker/aho.ts) and Shannon entropy
// (src/checker/entropy.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Aho } from '../src/checker/aho.ts'
import { shannon } from '../src/checker/entropy.ts'

function hits(words: string[], text: string): [number, number][] {
  const out: [number, number][] = []
  new Aho(words).search(text, (word, end) => out.push([word, end]))
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0])
}

test('finds every occurrence, overlapping ones too', () => {
  assert.deepEqual(hits(['aa'], 'aaaa'), [[0, 2], [0, 3], [0, 4]])
  assert.deepEqual(hits(['she', 'he', 'hers'], 'ushers'), [[0, 4], [1, 4], [2, 6]])
})

test('is case-folded for ASCII only, one unit at a time', () => {
  assert.deepEqual(hits(['abc'], 'xxABCxx'), [[0, 5]])
  assert.deepEqual(hits(['abc'], 'AbC'), [[0, 3]])
  // A character whose lowercase is longer must not shift the offsets.
  assert.deepEqual(hits(['abc'], 'İabc'), [[0, 4]])
  assert.deepEqual(hits(['k'], 'K'), [])
})

test('handles non-ASCII keywords, empty text and no words', () => {
  assert.deepEqual(hits(['café'], 'un café noir'), [[0, 7]])
  assert.deepEqual(hits(['a'], ''), [])
  assert.deepEqual(hits([], 'abc'), [])
})

test('a word that is a suffix of another is reported at the same end', () => {
  assert.deepEqual(hits(['abcd', 'cd'], 'abcd'), [[0, 4], [1, 4]])
})

test('reports the same keyword given twice under both indexes', () => {
  assert.deepEqual(hits(['ab', 'ab'], 'ab'), [[0, 2], [1, 2]])
})

test('2 MB of text with 244 keywords is fast', () => {
  const words = Array.from({ length: 244 }, (_, i) => `kw${i.toString(36)}-${i}x`)
  const aho = new Aho(words)
  const text = 'the quick brown fox '.repeat(100_000)
  const t0 = performance.now()
  let n = 0
  aho.search(text, () => n++)
  const ms = performance.now() - t0
  assert.equal(n, 0)
  assert.ok(ms < 500, `${ms} ms`)
})

test('entropy: empty, uniform and mixed', () => {
  assert.equal(shannon(''), 0)
  assert.equal(shannon('aaaa'), 0)
  assert.equal(shannon('abab'), 1)
  assert.ok(Math.abs(shannon('abcdefgh') - 3) < 1e-9)
})

test('entropy divides by the UTF-8 length, as Gitleaks does', () => {
  // two characters of 2 bytes each: each has frequency 1/4, so the sum is 2 * 1/4 * 2 = 1
  assert.ok(Math.abs(shannon('éè') - 1) < 1e-9)
})
