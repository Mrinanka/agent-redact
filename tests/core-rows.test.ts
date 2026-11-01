// redactRow / withheldRow: walking a row's blocks (plan step 3, "Rows").

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { NO_ALLOW, Redactor, type RedactTextOptions, type Redacted } from '../src/core/session.ts'
import { redactRow, withheldRow, type RowMessage } from '../src/core/rows.ts'
import { makeFake, seededSource } from '../tools/test-sets/fakes.ts'

const src = seededSource('core-rows')
const GH = makeFake('github-pat', src).value
const AWS = makeFake('aws-access-key', src).value
const PW = 'Autumn' + '2026xk'

const make = (actions: Record<string, 'hide' | 'warn' | 'block'> = {}): Redactor =>
  new Redactor({ checker: createChecker({ actions }).checker, registered: [], hints: true, allow: NO_ALLOW })
const deadline = (): number => performance.now() + 20_000
const row = (content: RowMessage['content'], over: Partial<RowMessage> = {}): RowMessage => ({ type: 'user', role: 'user', content, ...over })

test('a text block is redacted; a row with nothing in it comes back as it was', () => {
  const r = make()
  const clean = row([{ type: 'text', text: 'nothing here' }])
  const same = redactRow(r, clean, { deadline: deadline() })
  assert.equal(same.changed, false)
  assert.equal(same.message, clean)
  const out = redactRow(r, row([{ type: 'text', text: `key ${GH}` }]), { deadline: deadline() })
  assert.equal(out.changed, true)
  assert.ok(!JSON.stringify(out.message).includes(GH))
  assert.equal(out.hits.length, 1)
  assert.equal(out.message.role, 'user')
})

test('a tool_result is redacted as a string and as an array of parts, and an image inside is left alone', () => {
  const r = make()
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
  const out = redactRow(r, row([
    { type: 'tool_result', tool_use_id: 't1', content: `out ${GH}` },
    { type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: `err ${AWS}` }, image] },
  ]), { deadline: deadline() })
  const [a, b] = out.message.content as unknown as [Record<string, unknown>, Record<string, unknown>]
  assert.equal(a.tool_use_id, 't1')
  assert.ok(!String(a.content).includes(GH))
  assert.equal(b.tool_use_id, 't2')
  assert.equal(b.is_error, true)
  const parts = b.content as Record<string, unknown>[]
  assert.ok(!String(parts[0]?.text).includes(AWS))
  assert.equal(parts[1], image)
})

test('tool_use, thinking and unknown blocks are never touched', () => {
  const r = make()
  const blocks = [
    { type: 'thinking', thinking: `hmm ${GH}`, signature: 's' },
    { type: 'tool_use', id: 'u1', name: 'Bash', input: { command: `echo ${GH}` } },
    { type: 'mystery', payload: GH },
  ]
  const out = redactRow(r, row(blocks, { type: 'assistant', role: 'assistant' }), { deadline: deadline() })
  assert.equal(out.changed, false)
  assert.deepEqual(out.message.content, blocks)
})

test('a value caught in a later block is hidden in an earlier one, and in a later row', () => {
  const r = make()
  const out = redactRow(r, row([
    { type: 'text', text: `first mention: ${PW}` },
    { type: 'text', text: `password=${PW}` },
  ]), { deadline: deadline() })
  assert.ok(!JSON.stringify(out.message).includes(PW))
  const next = redactRow(r, row([{ type: 'text', text: `bare again ${PW}` }]), { deadline: deadline() })
  assert.ok(!JSON.stringify(next.message).includes(PW))
})

test("a tool_result's file name comes from the tool_use_id lookup", () => {
  const seen: (string | undefined)[] = []
  const spy = {
    version: 0,
    redactText(text: string, o: RedactTextOptions): Redacted {
      seen.push(o.file)
      return { text, hits: [], complete: true, blocked: false, capped: false }
    },
  }
  redactRow(spy, row([
    { type: 'tool_result', tool_use_id: 'known', content: 'a' },
    { type: 'tool_result', tool_use_id: 'unknown', content: 'b' },
    { type: 'text', text: 'c' },
  ]), { deadline: deadline(), fileOf: id => (id === 'known' ? 'src/app.ts' : undefined) })
  assert.deepEqual(seen, ['src/app.ts', undefined, undefined])
})

test('a block action reports blocked; an incomplete check reports complete: false', () => {
  const blocking = redactRow(make({ 'github-pat': 'block' }), row([{ type: 'text', text: `x ${GH}` }]), { deadline: deadline() })
  assert.equal(blocking.blocked, true)
  const lateReal = redactRow(make(), row([{ type: 'text', text: `password=${PW}` }]), { deadline: performance.now() - 1 })
  assert.equal(lateReal.complete, false)
})

test('a value too long to remember is reported for the whole row, from any block; a plain row has no such field', () => {
  const long = 'Kq7'.repeat(2731)
  const out = redactRow(make(), row([{ type: 'text', text: `password=${long}` }, { type: 'text', text: 'after it' }]), { deadline: deadline() })
  assert.equal(out.tooLong, true)
  assert.equal('tooLong' in redactRow(make(), row([{ type: 'text', text: `x ${GH}` }]), { deadline: deadline() }), false)
})

test('withheldRow keeps what the engine pins and replaces the rest with a note that holds no content', () => {
  const think = { type: 'thinking', thinking: 't', signature: 's' }
  const use = { type: 'tool_use', id: 'u1', name: 'Bash', input: { command: 'ls' } }
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
  const m: RowMessage = { type: 'user', role: 'user', name: 'x', isMeta: true, content: [
    think,
    { type: 'text', text: `secret ${GH}` },
    { type: 'text', text: 'more' },
    { type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: GH }, image] },
    { type: 'tool_result', tool_use_id: 't2', content: GH },
    use,
    image,
  ] }
  const w = withheldRow(m, 'a check failed')
  assert.equal(w.type, 'user')
  assert.equal(w.role, 'user')
  assert.equal(w.name, 'x')
  assert.equal(w.isMeta, true)
  assert.ok(!JSON.stringify(w).includes(GH))
  assert.ok(w.content.includes(think))
  assert.ok(w.content.includes(use))
  const results = w.content.filter(b => b.type === 'tool_result') as Record<string, unknown>[]
  assert.deepEqual(results.map(b => [b.tool_use_id, b.is_error ?? false]), [['t1', true], ['t2', false]])
  const texts = w.content.filter(b => b.type === 'text') as unknown as { text: string }[]
  assert.equal(texts.length, 1)
  assert.match(texts[0]!.text, /withheld.*a check failed/)
  assert.ok(!w.content.some(b => b.type === 'image'))
})

test('withheldRow of a row with only a text block is one note', () => {
  const w = withheldRow(row([{ type: 'text', text: GH }]), 'it holds a secret that settings say to block')
  assert.equal(w.content.length, 1)
  assert.match((w.content[0] as unknown as { text: string }).text, /^\[aegiscontext withheld this content: /)
})
