// The regex layer (src/checker/re): Go RE2 syntax parsed to a tree, analysed, and
// emitted as JS regex source that relies on no newer regex feature.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, RegexError } from '../src/checker/re/parse.ts'
import { analyze } from '../src/checker/re/analyze.ts'
import { emit } from '../src/checker/re/emit.ts'

const js = (src: string, cap?: number): RegExp => {
  const e = emit(parse(src).node, cap === undefined ? {} : { cap })
  return new RegExp(e.source, e.flags)
}
const matches = (src: string, text: string): string | null => js(src).exec(text)?.[0] ?? null

test('parses literals, classes, groups, alternation and repeats', () => {
  assert.equal(matches('ab+c', 'xabbbc'), 'abbbc')
  assert.equal(matches('^(?:foo|bar)$', 'bar'), 'bar')
  assert.equal(matches('[a-c]{2,3}', 'zabcd'), 'abc')
  assert.equal(matches('a{2,}?', 'aaaa'), 'aa')
  assert.equal(matches('x(?P<name>y+)z', 'xyyz'), 'xyyz')
  assert.equal(parse('x(?P<name>y+)(z)').groups, 2)
})

test('POSIX classes, escapes inside and outside classes', () => {
  assert.equal(matches('[[:alnum:]]+', '--ab12--'), 'ab12')
  assert.equal(matches('[[:^alnum:]]+', 'ab--12'), '--')
  assert.equal(matches('\\x60+', 'a``b'), '``')
  assert.equal(matches('\\x{41}', 'zA'), 'A')
  assert.equal(matches('[\\d\\-x]+', 'a1-x2b'), '1-x2')
  assert.equal(matches('[^\\s]+', '  ab '), 'ab')
  assert.equal(matches('[\\S]+', '  ab '), 'ab')
  assert.equal(matches('\\Qa.b\\E', 'axb a.b'), 'a.b')
  assert.equal(matches('[]a]+', 'x]a]'), ']a]')
  assert.equal(matches('a\\.b', 'a.b'), 'a.b')
})

test('Go dot excludes only \\n, and (?s:) includes it', () => {
  assert.equal(matches('a.b', 'a\nb'), null)
  assert.equal(matches('a.b', 'a\rb'), 'a\rb')
  assert.equal(matches('(?s:a.b)', 'a\nb'), 'a\nb')
})

test('\\s is Go\'s narrow set, not JS\'s wide one', () => {
  assert.equal(matches('a\\sb', 'a b'), 'a b')
  assert.equal(matches('a\\sb', 'a\r\nb'), null)
  assert.equal(matches('a\\sb', 'a b'), null)
  assert.equal(matches('a\\sb', 'a b'), null)
  assert.equal(matches('a\\sb', 'a\u000bb'), null)
  assert.equal(matches('a\\Sb', 'a b'), 'a b')
})

test('$ and ^ mean the end and start of the text only', () => {
  assert.equal(matches('a$', 'a\r\n'), null)
  assert.equal(matches('a$', 'a'), 'a')
  assert.equal(matches('a\\z', 'a\n'), null)
  assert.equal(matches('^a', 'b\na'), null)
  assert.equal(matches('\\Aa', 'ab'), 'a')
  assert.equal(matches('(?:[\\s;]|$)', 'x'), '')
})

test('a whole-pattern (?i) becomes the i flag', () => {
  const e = emit(parse('(?i)abc[d-f]').node, {})
  assert.equal(e.flags, 'i')
  assert.equal(new RegExp(e.source, e.flags).test('ABCE'), true)
})

test('a partial (?i) and (?-i: expand case by themselves', () => {
  const partial = emit(parse('p8e-(?i)[a-z0-9]{3}').node, {})
  assert.equal(partial.flags, '')
  const re = new RegExp(partial.source)
  assert.equal(re.test('p8e-AbC'), true)
  assert.equal(re.test('P8E-abc'), false)
  const off = emit(parse('(?i)ab(?-i:cd)').node, {})
  const re2 = new RegExp(off.source, off.flags)
  assert.equal(re2.test('ABcd'), true)
  assert.equal(re2.test('ABCD'), false)
  const scoped = emit(parse('(?i:a)b').node, {})
  const re3 = new RegExp(scoped.source, scoped.flags)
  assert.equal(re3.test('Ab'), true)
  assert.equal(re3.test('AB'), false)
})

test('a negated class with case folding excludes both cases', () => {
  const e = emit(parse('(?i:[^a])b').node, {})
  const re = new RegExp(e.source, e.flags)
  assert.equal(re.test('Ab'), false)
  assert.equal(re.test('ab'), false)
  assert.equal(re.test('xb'), true)
})

test('unbounded repeats are capped', () => {
  const small = js('a+', 5)
  assert.equal(small.exec('aaaaaaaaaa')?.[0], 'aaaaa')
  assert.match(emit(parse('a*').node, {}).source, /\{0,16384\}/)
})

test('a repeat of an assertion is wrapped so the engine accepts it', () => {
  assert.doesNotThrow(() => js('(?:\\b){2}a'))
})

test('rejects what RE2 rejects and what is not supported', () => {
  const bad = ['(a)\\1', '(?=a)', '(?!a)', '(?<=a)', '(?<n>a)', 'a**', 'a++', '(', ')', '[a', 'a{2,1}', '\\pL', '(?m)a', '(?U)a', '\\', 'a{1001}', '[z-a]', '*a']
  for (const src of bad) assert.throws(() => parse(src), RegexError, src)
})

test('a syntax error names the position, never the pattern', () => {
  try {
    parse('abc(?=x)')
    assert.fail('should throw')
  } catch (e) {
    assert.ok(e instanceof RegexError)
    assert.equal(e.at, 3)
    assert.ok(!e.message.includes('abc'))
  }
})

test('CRLF: a value ending a Windows line still ends at the \\r', () => {
  assert.equal(matches('=([a-z]+)(?:[\\s;]|$)', 'k=abc\r\nn=x'), '=abc\r')
})

// ---- analyze ----------------------------------------------------------------------

test('required literals: a prefix, case-folded', () => {
  assert.deepEqual(analyze(parse('\\bghp_[0-9a-zA-Z]{36}\\b').node).keywords, ['ghp_'])
  assert.deepEqual(analyze(parse('(?i)\\bAKIA[A-Z2-7]{16}').node).keywords, ['akia'])
})

test('required literals: alternatives and optional parts', () => {
  const k = analyze(parse('(?:sk|rk)_(?:test|live)_[a-z]{10}').node).keywords
  assert.ok(k && k.every(s => s.length >= 3), String(k))
  assert.ok(k.includes('sk_test_') || k.some(s => s.startsWith('sk_')), String(k))
  assert.equal(analyze(parse('[a-z]{10}').node).keywords, null)
  assert.equal(analyze(parse('(?:abc)?[a-z]{10}').node).keywords, null)
})

test('required literals: a literal after a long class run is found', () => {
  assert.deepEqual(analyze(parse('[a-z]{5}-secret-[0-9]{4}').node).keywords, ['-secret-'])
})

test('required literals: the better of several runs wins', () => {
  const k = analyze(parse('a[0-9]+longliteral[0-9]+b').node).keywords
  assert.deepEqual(k, ['longliteral'])
})

test('widths and line spans', () => {
  const a = analyze(parse('ab[0-9]{2,5}').node)
  assert.equal(a.minLen, 4)
  assert.equal(a.maxLen, 7)
  assert.equal(analyze(parse('a[^x]b').node).spansLines, true)
  assert.equal(analyze(parse('a[a-z]b').node).spansLines, false)
  assert.equal(analyze(parse('a.b').node).spansLines, false)
  assert.equal(analyze(parse('a\\sb').node).spansLines, true)
  assert.equal(analyze(parse('a[\\n]b').node).spansLines, true)
})

test('an unbounded repeat is counted at the cap', () => {
  const a = analyze(parse('a+b').node)
  assert.equal(a.unbounded, true)
  assert.equal(a.maxLen, 16384 + 1)
})

test('the stuck-cost bound: adjacent overlapping repeats multiply', () => {
  const lone = analyze(parse('x[a-z]{0,50}y').node).cost
  const pair = analyze(parse('x[a-z]{0,50}[a-z]{0,50}y').node).cost
  const apart = analyze(parse('x[a-z]{0,50}-[0-9]{0,50}y').node).cost
  assert.ok(pair > lone * 40, `${pair} vs ${lone}`)
  assert.ok(apart < pair / 5, `${apart} vs ${pair}`)
})

test('a variable repeat around a variable-length body is flagged', () => {
  assert.equal(analyze(parse('(?:a|bb)+c').node).nestedVariable, true)
  assert.equal(analyze(parse('(?:a{1,3}){2,5}').node).nestedVariable, true)
  assert.equal(analyze(parse('(?:ab){3}c').node).nestedVariable, false)
  assert.equal(analyze(parse('(?:a?b){4}').node).nestedVariable, false)
})

test('a leading lazy [\\w.-]{0,50}? is reported so it can be dropped', () => {
  const a = analyze(parse('(?i)[\\w.-]{0,50}?(?:adafruit)[0-9]{3}').node)
  assert.ok(a.leading)
  assert.equal(a.leading?.max, 50)
  assert.equal(analyze(parse('(?:adafruit)[0-9]{3}').node).leading, null)
})
