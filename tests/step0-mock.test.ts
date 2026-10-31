// Tests for the Step 0 mock model API (experiments/step0-mock/server.ts, D-020).
// The mock records only shapes and sizes, plus whether each canary was seen.
// A canary must never reach its records, in memory or on disk.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { startMock, type MockServer, type Script } from '../experiments/step0-mock/server.ts'

// Built at run time from pieces: never written whole in the repo.
function canary(): string {
  return ['CANARY', randomBytes(8).toString('hex')].join('-')
}

function body(messages: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ model: 'mock-model', max_tokens: 64, stream: true, messages, ...extra })
}

async function post(m: MockServer, text: string, url = '/v1/messages?beta=true'): Promise<Response> {
  return fetch(`http://${m.host}:${m.port}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'mock-not-a-key' },
    body: text,
  })
}

type SseEvent = { event: string; data: any }

async function readSse(res: Response): Promise<SseEvent[]> {
  const raw = await res.text()
  return raw
    .split('\n\n')
    .filter(chunk => chunk.trim() !== '')
    .map(chunk => {
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? ''
      const data = JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? 'null')
      return { event, data }
    })
}

async function withMock(opts: Parameters<typeof startMock>[0], fn: (m: MockServer) => Promise<void>): Promise<void> {
  const m = await startMock(opts)
  try {
    await fn(m)
  } finally {
    await m.close()
  }
}

test('streams a text reply as valid SSE (check 0.11)', async () => {
  await withMock({ script: () => ({ kind: 'text', text: 'hello there' }) }, async m => {
    const res = await post(m, body([{ role: 'user', content: 'hi' }]))
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    const events = await readSse(res)
    assert.deepEqual(events.map(e => e.event), [
      'message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
    ])
    const text = events.filter(e => e.event === 'content_block_delta').map(e => e.data.delta.text).join('')
    assert.equal(text, 'hello there')
    assert.equal(events.find(e => e.event === 'message_delta')?.data.delta.stop_reason, 'end_turn')
  })
})

test('streams a tool_use reply whose input parses back whole', async () => {
  const input = { file_path: path.join('scratch', 'a.txt'), note: 'naïve ✓' }
  await withMock({ script: () => ({ kind: 'tool', name: 'Read', input }) }, async m => {
    const events = await readSse(await post(m, body([{ role: 'user', content: 'go' }])))
    const start = events.find(e => e.event === 'content_block_start' && e.data.content_block.type === 'tool_use')
    assert.ok(start, 'a tool_use block starts')
    assert.equal(start.data.content_block.name, 'Read')
    assert.match(start.data.content_block.id, /^toolu_/)
    const json = events
      .filter(e => e.event === 'content_block_delta' && e.data.delta.type === 'input_json_delta')
      .map(e => e.data.delta.partial_json)
      .join('')
    assert.deepEqual(JSON.parse(json), input)
    assert.equal(events.find(e => e.event === 'message_delta')?.data.delta.stop_reason, 'tool_use')
  })
})

test('answers a non-streaming request with a JSON message', async () => {
  await withMock({ script: () => ({ kind: 'text', text: 'plain' }) }, async m => {
    const res = await post(m, body([{ role: 'user', content: 'hi' }], { stream: false }))
    assert.equal(res.status, 200)
    const msg = await res.json() as any
    assert.equal(msg.type, 'message')
    assert.equal(msg.content[0].text, 'plain')
  })
})

test('the script sees the parsed request: tools, messages and the last user text', async () => {
  const seen: { hasTools: boolean; nMsgs: number; last: string }[] = []
  const script: Script = req => {
    seen.push({ hasTools: req.hasTools, nMsgs: req.messages.length, last: req.lastUserText })
    return { kind: 'text', text: 'ok' }
  }
  await withMock({ script }, async m => {
    await (await post(m, body([{ role: 'user', content: [{ type: 'text', text: 'first' }] }], { tools: [{ name: 'Read' }] }))).text()
    await (await post(m, body([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'result text' }] }] },
    ]))).text()
  })
  assert.deepEqual(seen, [
    { hasTools: true, nMsgs: 1, last: 'first' },
    { hasTools: false, nMsgs: 3, last: 'result text' },
  ])
})

test('the script sees the request tool names; the record keeps them only as safe labels', async () => {
  let names: readonly string[] = []
  const script: Script = req => {
    names = req.toolNames
    return { kind: 'text', text: 'ok' }
  }
  await withMock({ script }, async m => {
    await (await post(m, body([{ role: 'user', content: 'hi' }], { tools: [{ name: 'Read' }, { name: 'mcp__srv__do_thing' }, { name: 'bad name!' }, { type: 'web_search_20250305' }] }))).text()
    assert.deepEqual(m.records[0]?.tools, ['Read', 'mcp__srv__do_thing', '(odd)', '(odd)'])
  })
  assert.deepEqual(names, ['Read', 'mcp__srv__do_thing', 'bad name!', ''])
})

test('never records content: canaries in LF, CRLF and Unicode bodies are flagged but absent from the records', async () => {
  const lf = canary()
  const crlf = canary()
  const uni = canary()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'step0-mock-'))
  const recordPath = path.join(dir, 'requests.jsonl')
  try {
    await withMock({ canaries: [lf, crlf, uni], recordPath }, async m => {
      await (await post(m, body([{ role: 'user', content: `line one\n${lf}\nline three` }]))).text()
      await (await post(m, body([{ role: 'user', content: `a\r\nkey=${crlf}\r\nb` }]))).text()
      await (await post(m, body([{ role: 'user', content: `日本語 ${uni} — ok` }], { system: [{ type: 'text', text: 'sys' }] }))).text()
      const inMemory = JSON.stringify(m.records)
      for (const c of [lf, crlf, uni]) assert.ok(!inMemory.includes(c), 'canary absent from in-memory records')
      assert.deepEqual(m.records.map(r => r.canaries), [
        { [lf]: true, [crlf]: false, [uni]: false },
        { [lf]: false, [crlf]: true, [uni]: false },
        { [lf]: false, [crlf]: false, [uni]: true },
      ].map(flags => Object.fromEntries(Object.entries(flags).map(([k, v], i) => [`c${i}`, v]))))
    })
    const onDisk = await fs.readFile(recordPath, 'utf8')
    for (const c of [lf, crlf, uni]) assert.ok(!onDisk.includes(c), 'canary absent from the records file')
    assert.equal(onDisk.trim().split('\n').length, 3)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('records each block by type and size only', async () => {
  await withMock({}, async m => {
    await (await post(m, body([
      { role: 'user', content: [
        { type: 'text', text: '12345' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBBBBBB' } },
      ] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_9', name: 'Bash', input: { command: 'ls' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', is_error: true, content: 'boom' }] },
    ], { tools: [{ name: 'Bash' }, { name: 'Read' }] }))).text()
    const [r] = m.records
    assert.ok(r)
    assert.equal(r.nTools, 2)
    assert.deepEqual(r.msgs, [
      { role: 'user', blocks: [
        { type: 'text', chars: 5 },
        { type: 'image', chars: 4, mediaType: 'image/png' },
        { type: 'document', chars: 8, mediaType: 'application/pdf' },
      ] },
      { role: 'assistant', blocks: [{ type: 'tool_use', name: 'Bash', chars: JSON.stringify({ command: 'ls' }).length }] },
      { role: 'user', blocks: [{ type: 'tool_result', chars: 4, isError: true }] },
    ])
  })
})

test('a tool_result whose content is a block list records its part types (an image inside a Read result)', async () => {
  await withMock({}, async m => {
    await (await post(m, body([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [
        { type: 'text', text: 'ab' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ] }] },
    ]))).text()
    assert.deepEqual(m.records[0]?.msgs[0]?.blocks, [{ type: 'tool_result', chars: 2, parts: ['text', 'image'] }])
  })
})

test('an odd tool name or media type is recorded as a safe label', async () => {
  await withMock({}, async m => {
    await (await post(m, body([
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'has spaces and = signs', input: {} }] },
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'text/x;secret=1', data: '' } }] },
    ]))).text()
    const blocks = m.records[0]?.msgs.flatMap(x => x.blocks)
    assert.equal(blocks?.[0]?.name, '(odd)')
    assert.equal(blocks?.[1]?.mediaType, '(odd)')
  })
})

test('failure: malformed JSON gets a 400 and the server keeps answering', async () => {
  await withMock({}, async m => {
    const bad = await post(m, '{"model": "x", "messages": [')
    assert.equal(bad.status, 400)
    await bad.text()
    const good = await post(m, body([{ role: 'user', content: 'hi' }]))
    assert.equal(good.status, 200)
    await good.text()
  })
})

test('failure: an unknown path gets a 404, and count_tokens gets a count', async () => {
  await withMock({}, async m => {
    const res = await fetch(`http://${m.host}:${m.port}/v1/nope`)
    assert.equal(res.status, 404)
    await res.text()
    const count = await post(m, body([{ role: 'user', content: 'hi' }]), '/v1/messages/count_tokens?beta=true')
    assert.equal(count.status, 200)
    assert.equal(typeof ((await count.json()) as any).input_tokens, 'number')
  })
})

test('huge input: a 5 MB body is read whole and its canary still found', async () => {
  const c = canary()
  const big = 'x'.repeat(5 * 1024 * 1024) + c
  await withMock({ canaries: [c] }, async m => {
    const res = await post(m, body([{ role: 'user', content: big }]))
    assert.equal(res.status, 200)
    await res.text()
    assert.equal(m.records[0]?.msgs[0]?.blocks[0]?.chars, big.length)
    assert.deepEqual(m.records[0]?.canaries, { c0: true })
  })
})

test('listens on 127.0.0.1 only (no network)', async () => {
  await withMock({}, async m => {
    assert.equal(m.host, '127.0.0.1')
    assert.ok(m.port > 0)
  })
})

test('a script that throws gets a 500 and the server keeps answering', async () => {
  let calls = 0
  const script: Script = () => {
    calls += 1
    if (calls === 1) throw new Error('script bug')
    return { kind: 'text', text: 'ok' }
  }
  await withMock({ script }, async m => {
    const first = await post(m, body([{ role: 'user', content: 'a' }]))
    assert.equal(first.status, 500)
    await first.text()
    const second = await post(m, body([{ role: 'user', content: 'b' }]))
    assert.equal(second.status, 200)
    await second.text()
  })
})
