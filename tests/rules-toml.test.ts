// The TOML reader (tools/rules/toml.ts): only the subset the Gitleaks file uses,
// and a loud failure on anything else.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseToml } from '../tools/rules/toml.ts'

test('reads tables, array tables, strings, numbers and arrays', () => {
  const doc = parseToml(
    [
      '# comment',
      'title = "t"',
      '[allowlist]',
      'regexes = [',
      "    '''a\\.b''',  # trailing",
      "    '''c''',",
      ']',
      'stopwords = ["x", "y"]',
      '[[rules]]',
      'id = "one"',
      'entropy = 3.5',
      '[[rules.allowlists]]',
      'condition = "AND"',
      '[[rules]]',
      'id = "two"',
      'keywords = ["k"]',
    ].join('\n'),
  )
  assert.equal(doc.title, 't')
  assert.deepEqual((doc.allowlist as any).regexes, ['a\\.b', 'c'])
  assert.deepEqual((doc.allowlist as any).stopwords, ['x', 'y'])
  const rules = doc.rules as any[]
  assert.equal(rules.length, 2)
  assert.equal(rules[0].entropy, 3.5)
  assert.equal(rules[0].allowlists[0].condition, 'AND')
  assert.deepEqual(rules[1].keywords, ['k'])
})

test('triple-quoted literals keep backslashes and quotes', () => {
  const doc = parseToml("a = '''x\\s'\"y'''\n")
  assert.equal(doc.a, 'x\\s\'"y')
})

test('basic strings understand escapes', () => {
  assert.equal(parseToml('a = "q\\"\\\\n"').a, 'q"\\n')
})

test('fails loudly on anything outside the subset', () => {
  assert.throws(() => parseToml('a = 1979-05-27'), /line 1/)
  assert.throws(() => parseToml('a = { b = 1 }'), /line 1/)
  assert.throws(() => parseToml('a = """x"""'), /line 1/)
  assert.throws(() => parseToml('a = [1, 2'), /unterminated/)
  assert.throws(() => parseToml("a = '''x"), /unterminated/)
  assert.throws(() => parseToml('???'), /line 1/)
})

test('reads the vendored file: 222 rules', () => {
  const text = fs.readFileSync(path.join(import.meta.dirname, '..', 'third_party', 'gitleaks', 'gitleaks.toml'), 'utf8')
  const doc = parseToml(text)
  assert.equal((doc.rules as unknown[]).length, 222)
})
