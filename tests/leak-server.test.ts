// The kit's mock model API (tools/leak-test/server.ts). It starts from the Step 0
// mock and fixes what could give a false pass: every request is scanned and
// recorded, whatever its path or encoding, and what can't be read is flagged.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { startLeakMock, type LeakMock, type Script } from '../tools/leak-test/server.ts'
import { needlesFor, witnessNeedle } from '../tools/leak-test/detect.ts'
import { makeFake, randomSource } from '../tools/test-sets/fakes.ts'

const src = randomSource()
const fake = () => makeFake('github-pat', src).value

function body(messages: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ model: 'mock-model', max_tokens: 64, stream: true, messages, ...extra })
}

async function post(m: LeakMock, data: string | Buffer, url = '/v1/messages?beta=true', headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`http://${m.host}:${m.port}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'mock-not-a-key', ...headers },
    body: typeof data === 'string' ? data : new Uint8Array(data),
  })
}

async function withMock(opts: Parameters<typeof startLeakMock>[0], fn: (m: LeakMock) => Promise<void>): Promise<void> {
  const m = await startLeakMock(opts)
  try {
    await fn(m)
  } finally {
    await m.close()
  }
}

test('streams a text reply as valid SSE', async () => {
  await withMock({ script: () => ({ kind: 'text', text: 'hello there' }) }, async m => {
    const res = await post(m, body([{ role: 'user', content: 'hi' }]))
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    const raw = await res.text()
    assert.match(raw, /event: message_start/)
    assert.match(raw, /hello there/)
    assert.match(raw, /"stop_reason":"end_turn"/)
  })
})

test('streams a tool call whose input parses back whole', async () => {
  const input = { file_path: 'a.txt', note: 'naïve ✓' }
  await withMock({ script: () => ({ kind: 'tool', name: 'Read', input }) }, async m => {
    const raw = await (await post(m, body([{ role: 'user', content: 'go' }]))).text()
    const json = [...raw.matchAll(/"partial_json":("(?:[^"\\]|\\.)*")/g)].map(x => JSON.parse(x[1] ?? '""')).join('')
    assert.deepEqual(JSON.parse(json), input)
    assert.match(raw, /"stop_reason":"tool_use"/)
  })
})

test('answers a non-streaming request with a JSON message', async () => {
  await withMock({ script: () => ({ kind: 'text', text: 'plain' }) }, async m => {
    const msg = await (await post(m, body([{ role: 'user', content: 'hi' }], { stream: false }))).json() as { content: { text: string }[] }
    assert.equal(msg.content[0]?.text, 'plain')
  })
})

test('the script sees tools, messages and the last user text', async () => {
  const seen: unknown[] = []
  const script: Script = r => {
    seen.push({ hasTools: r.hasTools, names: r.toolNames, last: r.lastUserText, first: r.firstUserText, index: r.index })
    return { kind: 'text', text: 'ok' }
  }
  await withMock({ script }, async m => {
    await (await post(m, body([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: 'result text' }] }] },
    ], { tools: [{ name: 'Read' }] }))).text()
  })
  assert.deepEqual(seen, [{ hasTools: true, names: ['Read'], last: 'result text', first: 'q', index: 0 }])
})

test('a fake is found and recorded by label, and never held in the record', async () => {
  const value = fake()
  await withMock({ needles: needlesFor('prompt.github-pat', value) }, async m => {
    await (await post(m, body([{ role: 'user', content: `a ${value} b` }]))).text()
    assert.deepEqual(m.records[0]?.hits, [{ fakeId: 'prompt.github-pat', part: 'messages', form: 'plain' }])
    assert.ok(!JSON.stringify(m.records).includes(value))
  })
})

test('a witness is reported the same way', async () => {
  await withMock({ needles: [witnessNeedle('w:door', 'witness-aaaabbbbccccdddd')] }, async m => {
    await (await post(m, body([{ role: 'user', content: 'x witness-aaaabbbbccccdddd y' }]))).text()
    assert.equal(m.records[0]?.hits[0]?.fakeId, 'w:door')
  })
})

test('the Step 0 gap: a fake sent to an unknown path is found', async () => {
  const value = fake()
  await withMock({ needles: needlesFor('f', value) }, async m => {
    const res = await post(m, JSON.stringify({ event: value }), '/api/event_logging/batch')
    assert.equal(res.status, 404)
    await res.text()
    assert.equal(m.records.length, 1)
    assert.equal(m.records[0]?.path, '/api/event_logging/batch')
    assert.equal(m.records[0]?.hits.length, 1)
  })
})

test('the Step 0 gap: a fake sent to count_tokens is found, and the count still answered', async () => {
  const value = fake()
  await withMock({ needles: needlesFor('f', value) }, async m => {
    const res = await post(m, body([{ role: 'user', content: value }]), '/v1/messages/count_tokens?beta=true')
    assert.equal(res.status, 200)
    assert.equal(typeof ((await res.json()) as { input_tokens: number }).input_tokens, 'number')
    assert.equal(m.records[0]?.hits.length, 1)
  })
})

test('a fake in a GET url or in a header is found', async () => {
  const value = fake()
  await withMock({ needles: needlesFor('f', value) }, async m => {
    await (await fetch(`http://${m.host}:${m.port}/v1/models?k=${value}`)).text()
    await (await post(m, body([]), '/v1/messages', { 'x-note': value })).text()
    assert.deepEqual(m.records.map(r => r.hits[0]?.part), ['url', 'headers'])
  })
})

for (const [name, encode] of [
  ['gzip', (b: Buffer) => zlib.gzipSync(b)],
  ['deflate', (b: Buffer) => zlib.deflateSync(b)],
  ['br', (b: Buffer) => zlib.brotliCompressSync(b)],
  ['zstd', (b: Buffer) => zlib.zstdCompressSync(b)],
] as const) {
  test(`reads a ${name} body and finds the fake inside`, async () => {
    const value = fake()
    await withMock({ needles: needlesFor('f', value) }, async m => {
      const res = await post(m, encode(Buffer.from(body([{ role: 'user', content: value }]))), '/v1/messages', { 'content-encoding': name })
      assert.equal(res.status, 200)
      await res.text()
      assert.equal(m.records[0]?.encoding, name)
      assert.equal(m.records[0]?.hits.length, 1)
      assert.equal(m.records[0]?.unreadable, undefined)
    })
  })
}

test('failure: an unknown encoding is flagged unreadable, not passed as clean', async () => {
  await withMock({}, async m => {
    const res = await post(m, Buffer.from([1, 2, 3]), '/v1/messages', { 'content-encoding': 'compress' })
    assert.equal(res.status, 400)
    await res.text()
    assert.equal(m.records[0]?.unreadable, 'unknown-encoding')
  })
})

test('failure: a broken gzip body is flagged unreadable', async () => {
  await withMock({}, async m => {
    const res = await post(m, Buffer.from('not gzip at all'), '/v1/messages', { 'content-encoding': 'gzip' })
    assert.equal(res.status, 400)
    await res.text()
    assert.equal(m.records[0]?.unreadable, 'bad-encoding')
  })
})

test('failure: an oversized body is flagged unreadable, not skipped', async () => {
  await withMock({ maxBody: 1024 }, async m => {
    const res = await post(m, 'x'.repeat(4096))
    assert.equal(res.status, 413)
    await res.text()
    assert.equal(m.records[0]?.unreadable, 'too-large')
  })
})

test('failure: malformed JSON to /v1/messages is scanned, gets a 400, and the server keeps answering', async () => {
  const value = fake()
  await withMock({ needles: needlesFor('f', value) }, async m => {
    const bad = await post(m, `{"model": "x", "messages": [ ${value}`)
    assert.equal(bad.status, 400)
    await bad.text()
    assert.equal(m.records[0]?.hits.length, 1)
    const good = await post(m, body([{ role: 'user', content: 'hi' }]))
    assert.equal(good.status, 200)
    await good.text()
  })
})

test('failure: a script that throws gets a 500, the request stays recorded, and the server keeps answering', async () => {
  let calls = 0
  const script: Script = () => {
    calls += 1
    if (calls === 1) throw new Error('script bug')
    return { kind: 'text', text: 'ok' }
  }
  await withMock({ script }, async m => {
    assert.equal((await post(m, body([]))).status, 500)
    assert.equal((await post(m, body([]))).status, 200)
    assert.equal(m.records.length, 2)
    assert.equal(m.records[0]?.reply, 'error')
  })
})

test('an odd path is recorded as a safe label', async () => {
  await withMock({}, async m => {
    await (await fetch(`http://${m.host}:${m.port}/has%20space=1`)).text()
    assert.equal(m.records[0]?.path, '(odd)')
  })
})

test('listens on 127.0.0.1 only (no network)', async () => {
  await withMock({}, async m => {
    assert.equal(m.host, '127.0.0.1')
    assert.ok(m.port > 0)
  })
})
