// scrubResponse: cleans every string of a tool's response and keeps its shape (spec §5.2, check 0.9).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { NO_ALLOW, Redactor } from '../src/core/session.ts'
import { scrubResponse, withholdResponse } from '../src/backup/scrub.ts'
import { holdsFake, needlesFor } from '../tools/leak-test/detect.ts'
import { makeFake, seededSource } from '../tools/test-sets/fakes.ts'

const src = seededSource('backup-scrub')
const GH = makeFake('github-pat', src).value
const AWS = makeFake('aws-access-key', src).value
const needles = [...needlesFor('gh', GH), ...needlesFor('aws', AWS)]

const redactor = (): Redactor => new Redactor({ checker: createChecker({}).checker, registered: [], hints: true, allow: NO_ALLOW })
const run = (value: unknown, o: { ms?: number; maxChars?: number; maxDepth?: number } = {}) => {
  const r = redactor()
  const deadline = performance.now() + (o.ms ?? 20_000)
  return scrubResponse(value, s => r.redactText(s, { deadline }), { ...(o.maxChars ? { maxChars: o.maxChars } : {}), ...(o.maxDepth ? { maxDepth: o.maxDepth } : {}) })
}
const shapeOf = (v: unknown): unknown => (typeof v === 'string' ? 's' : Array.isArray(v) ? v.map(shapeOf) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x)])) : v)

test('a Bash-shaped response keeps every key and type, with the secret gone', () => {
  const response = { stdout: `token ${GH}\nok\n`, stderr: '', interrupted: false, isImage: false, noOutputExpected: false }
  const out = run(response)
  assert.deepEqual(shapeOf(out.value), shapeOf(response))
  assert.ok(!holdsFake(JSON.stringify(out.value), needles))
  assert.equal(out.hits.length, 1)
  assert.equal(out.complete, true)
  assert.equal((out.value as typeof response).interrupted, false)
})

test('a Read-shaped response, an MCP content array and a bare string keep their shape', () => {
  const read = { type: 'text', file: { filePath: '/a/b.txt', content: `x=${AWS}`, numLines: 1, startLine: 1, totalLines: 1 } }
  const mcp = [{ type: 'text', text: `note ${GH}` }, { type: 'text', text: 'plain' }]
  for (const v of [read, mcp, `raw ${GH}`]) {
    const out = run(v)
    assert.deepEqual(shapeOf(out.value), shapeOf(v))
    assert.ok(!holdsFake(JSON.stringify(out.value), needles))
    assert.equal(out.hits.length, 1)
  }
})

test('text with no secret comes back equal, with no hits', () => {
  const v = { stdout: 'all good', n: 3, list: ['a', 'b'], nested: { deep: [null, true, 1.5] } }
  const out = run(v)
  assert.deepEqual(out.value, v)
  assert.deepEqual(out.hits, [])
  assert.equal(out.changed, false)
})

test('the input value is never changed', () => {
  const v = { stdout: GH }
  run(v)
  assert.equal(v.stdout, GH)
})

test('unknown shapes: null, numbers, an empty array, an array inside an array', () => {
  for (const v of [null, 7, true, [], {}, [[`a ${GH}`]], { a: { b: { c: [`z ${AWS}`] } } }]) {
    const out = run(v)
    assert.deepEqual(shapeOf(out.value), shapeOf(v))
    assert.ok(!holdsFake(JSON.stringify(out.value), needles))
  }
})

test('a depth bomb keeps its shape and reports an unfinished check', () => {
  let v: unknown = `end ${GH}`
  for (let i = 0; i < 5000; i++) v = [v]
  const out = run(v, { maxDepth: 64 })
  assert.equal(out.complete, false)
  let depth = 0
  for (let x: unknown = out.value; Array.isArray(x); x = x[0]) depth++
  assert.equal(depth, 5000)
})

test('text over the size cap is not scanned, and says so', () => {
  const v = { stdout: `${'a'.repeat(5000)}${GH}` }
  const out = run(v, { maxChars: 1000 })
  assert.equal(out.oversize, true)
  assert.equal(out.complete, false)
  assert.deepEqual(out.value, v)
})

test('the size cap counts all strings together', () => {
  const v = Array.from({ length: 100 }, () => 'b'.repeat(100))
  assert.equal(run(v, { maxChars: 5000 }).oversize, true)
  assert.equal(run(v, { maxChars: 50_000 }).oversize, false)
})

test('a deadline already passed leaves the check unfinished', () => {
  const out = run({ stdout: `a ${GH}\n`.repeat(200) }, { ms: -1 })
  assert.equal(out.complete, false)
})

test('CRLF line endings and unicode around a secret survive', () => {
  const text = `ligne ✓ 日本語 😀 ‮رمز\r\nkey ${GH}\r\nend\r\n`
  const out = run({ stdout: text })
  const got = (out.value as { stdout: string }).stdout
  assert.ok(got.includes('\r\n'))
  assert.ok(got.startsWith('ligne ✓ 日本語 😀 ‮رمز\r\n'))
  assert.ok(!got.includes(GH))
})

test('withholdResponse keeps the shape and drops every text', () => {
  const v = { stdout: `s ${GH}`, stderr: 'e', interrupted: false, content: [{ type: 'text', text: 'hello' }], n: 3 }
  const out = withholdResponse(v, 'withheld') as typeof v
  assert.deepEqual(shapeOf(out), shapeOf(v))
  assert.equal(out.stdout, 'withheld')
  assert.equal(out.content[0]?.type, 'text')
  assert.equal(out.content[0]?.text, 'withheld')
  assert.equal(out.n, 3)
  assert.equal(withholdResponse(`x ${GH}`, 'withheld'), 'withheld')
  assert.equal(withholdResponse(null, 'withheld'), null)
})
