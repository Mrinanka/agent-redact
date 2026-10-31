// SecretMatcher: many words, one pass, flat arrays (plan step 3, D-043).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SecretMatcher, type MatcherWord } from '../src/core/matcher.ts'

type Hit = { owner: number; start: number; end: number }

function run(words: MatcherWord[], text: string): Hit[] {
  const m = new SecretMatcher(words)
  const hits: Hit[] = []
  m.search(text, (owner, start, end) => hits.push({ owner, start, end }))
  return hits.sort((a, b) => a.start - b.start || a.end - b.end || a.owner - b.owner)
}

const w = (text: string, owner = 0, exact = true): MatcherWord => ({ text, owner, exact })

// A plain search, to compare against.
function brute(words: MatcherWord[], text: string): Hit[] {
  const out: Hit[] = []
  for (const word of words) {
    if (word.text === '') continue
    for (let i = 0; i + word.text.length <= text.length; i++) {
      const piece = text.slice(i, i + word.text.length)
      const same = word.exact ? piece === word.text : piece.toLowerCase() === word.text.toLowerCase()
      if (same) out.push({ owner: word.owner, start: i, end: i + word.text.length })
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end || a.owner - b.owner)
}

test('finds a word, with its owner and offsets', () => {
  assert.deepEqual(run([w('abc', 7)], 'xxabcxx'), [{ owner: 7, start: 2, end: 5 }])
})

test('overlapping and nested words are all reported', () => {
  const words = [w('abcd', 0), w('bc', 1), w('cde', 2)]
  assert.deepEqual(run(words, 'abcde'), brute(words, 'abcde'))
  assert.equal(run(words, 'abcde').length, 3)
})

test('a word inside a longer word is found, and a miss in the middle is not', () => {
  assert.equal(run([w('secret')], 'topsecretvalue').length, 1)
  assert.equal(run([w('secretvalue')], 'secret-value').length, 0)
  assert.equal(run([w('secretvalue')], 'secretXvalue').length, 0)
})

test('matching is case-sensitive unless the word says otherwise', () => {
  assert.equal(run([w('AbC')], 'abc ABC AbC').length, 1)
  assert.equal(run([w('deadbeef', 0, false)], 'DEADBEEF deadbeef DeadBeef').length, 3)
})

test('the same word for two owners reports both; an empty word is ignored', () => {
  assert.deepEqual(run([w('token1', 1), w('token1', 2), w('', 3)], 'token1').map(h => h.owner), [1, 2])
})

test('lone surrogates and non-ASCII units are matched as units', () => {
  const lone = '\ud83d'
  assert.equal(run([w(`a${lone}b`)], `xa${lone}by`).length, 1)
  assert.equal(run([w('日本語')], 'この日本語です').length, 1)
  assert.equal(run([w('é')], 'é é').length, 1)
})

test('agrees with a plain search on random inputs', () => {
  let seed = 12345
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed >>> 8) % n
  }
  const alphabet = 'abAB1_é'
  const str = (len: number): string => Array.from({ length: len }, () => alphabet[rnd(alphabet.length)]).join('')
  for (let round = 0; round < 200; round++) {
    const words = Array.from({ length: 1 + rnd(8) }, (_, i) => w(str(1 + rnd(5)), i, rnd(3) !== 0))
    const text = str(rnd(120))
    assert.deepEqual(run(words, text), brute(words, text), `round ${round}`)
  }
})

test('10 and 10,000 secrets take similar time to search, and memory stays bounded (registered-10k)', () => {
  const rand = (n: number, seed: string): string => {
    let h = 2166136261
    let out = ''
    for (let i = 0; i < n; i++) {
      h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 16777619) >>> 0
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
      out += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[h % 62]
    }
    return out
  }
  const make = (count: number): MatcherWord[] => Array.from({ length: count }, (_, i) => w(rand(48, `s${i}`), i))
  const text = ('plain log line with some words and ' + rand(64, 'log') + '\n').repeat(20_000) // about 2 MB
  const timeOf = (m: SecretMatcher): number => {
    let n = 0
    const t0 = performance.now()
    m.search(text, () => n++)
    return performance.now() - t0
  }
  const small = new SecretMatcher(make(10))
  timeOf(small) // warm up
  const t10 = timeOf(small)
  const before = process.memoryUsage().arrayBuffers
  const big = new SecretMatcher(make(10_000))
  const grown = process.memoryUsage().arrayBuffers - before
  timeOf(big)
  const t10k = timeOf(big)
  assert.ok(t10k < Math.max(t10 * 8, 400), `10 words ${t10.toFixed(0)} ms, 10,000 words ${t10k.toFixed(0)} ms`)
  assert.ok(grown < 120 * 1024 * 1024, `10,000 secrets of 48 characters used ${(grown / 1048576).toFixed(0)} MB`)
  // And the planted ones are found.
  const hits: number[] = []
  big.search(`..${rand(48, 's4242')}..`, o => hits.push(o))
  assert.deepEqual(hits, [4242])
})
