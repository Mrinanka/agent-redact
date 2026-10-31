// Tests for the Step 0 probe. Run with: claude plugin test ./experiments/step0-probe
//
// Nothing sits beneath the plugin in a test: the hooks registered on `on`
// stand for the engine, so each `$` call the probe makes is answered here.

import type { On, SessionAppendInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// A fake secret built from pieces, so no whole fake sits in the repo.
const FAKE = ['probe', 'FAKE', 'Zq8x', '7Lm93', 'Kd'].join('-')

const CWD = 'D:\\work\\scratch'
const SESSION = 'sess-0001'
const LOG_PATH = `${CWD}\\.step0-probe\\${SESSION}.jsonl`

type Write = { path: string; text: string }

type World = { writes: Write[]; session: ReturnType<typeof mock.session> }

// Answers every `$` call the probe makes. `existing` is what an earlier load
// left in the log file; `failWrites` makes every `$.fs.write` reject.
function world(on: On, opts: { existing?: string; failWrites?: boolean; failRead?: boolean } = {}): World {
  const writes: Write[] = []
  mock.clock(on, { now: 1_000 })
  on('session.id', () => ({ value: SESSION }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.version', () => ({ value: { version: '2.1.316', base: '2.1.316' } }))
  on('fs.exists', () => ({ value: opts.existing !== undefined }))
  on('fs.read', () => {
    if (opts.failRead) throw new Error('too large')
    return { value: opts.existing ?? '' }
  })
  on('fs.write', (_$, e) => {
    if (opts.failWrites) throw new Error('EACCES')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  const session = mock.session(on)
  return { writes, session }
}

function row(over: Partial<SessionAppendInput> & { content?: SessionAppendInput['message']['content'] }): SessionAppendInput {
  const { content, ...rest } = over
  return {
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u-1',
    message: { type: 'user', role: 'user', content: content ?? [{ type: 'text', text: 'hello' }] },
    ...rest,
  } as SessionAppendInput
}

function lastLines(w: World): Record<string, unknown>[] {
  const last = w.writes.at(-1)
  if (!last) return []
  return last.text.split('\n').filter(l => l !== '').map(l => JSON.parse(l) as Record<string, unknown>)
}

function rowLines(w: World): Record<string, unknown>[] {
  return lastLines(w).filter(l => l.kind === 'row')
}

test('writes one line per row with its door, type, role, origin and ids (check 0.1, spec 5.1)', async ($, on) => {
  const w = world(on)
  await $.session.append(row({
    door: 'attachment',
    origin: { kind: 'engine' },
    uuid: 'u-42',
    agentId: 'agent-7',
    message: { type: 'attachment', name: 'nested_memory', role: 'user', isMeta: true, content: [{ type: 'text', text: 'abc' }] },
  }))

  expect(w.writes.at(-1)?.path).toBe(LOG_PATH)
  expect(rowLines(w)).toEqual([expect.objectContaining({
    kind: 'row',
    seq: 1,
    door: 'attachment',
    type: 'attachment',
    name: 'nested_memory',
    role: 'user',
    isMeta: true,
    origin: { kind: 'engine' },
    uuid: 'u-42',
    agentId: 'agent-7',
    blocks: [{ type: 'text', chars: 3 }],
  })])
})

test('never writes content: a planted fake appears in no write (CLAUDE.md product rule)', async ($, on) => {
  const w = world(on)
  const b64 = btoa(FAKE)
  await $.session.append(row({ content: [{ type: 'text', text: `key is ${FAKE}` }] }))
  await $.session.append(row({
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Bash', note: FAKE } as unknown as SessionAppendInput['origin'],
    uuid: 'u-2',
    content: [
      { type: 'tool_result', tool_use_id: 't1', content: `out ${FAKE}` },
      { type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: FAKE }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } }] },
    ],
  }))
  await $.session.append(row({
    door: 'response',
    origin: { kind: 'model', model: 'claude-x' },
    uuid: 'u-3',
    message: {
      type: 'assistant', role: 'assistant', content: [
        { type: 'thinking', thinking: FAKE, signature: 'sig' },
        { type: 'tool_use', id: 't3', name: 'Bash', input: { command: `echo ${FAKE}` } },
      ],
    },
  }))
  await $.session.append(row({
    door: 'attachment',
    uuid: 'u-4',
    content: [{ type: 'document', source: { type: 'url', url: `https://x.test/${FAKE}` } }],
  }))

  expect(w.writes.length).toBeGreaterThan(0)
  for (const write of w.writes) {
    expect(write.text.includes(FAKE)).toBe(false)
    expect(write.text.includes(b64)).toBe(false)
  }
})

test('records each kind of block by type and size only', async ($, on) => {
  const w = world(on)
  await $.session.append(row({
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Read' },
    content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'abcd' },
      { type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: 'xy' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBBBB' } },
      { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'ls' } },
      { type: 'thinking', thinking: 'hmm', signature: 's' },
      { type: 'redacted_thinking', data: 'zzzzz' },
    ],
  }))

  expect(rowLines(w)[0]?.blocks).toEqual([
    { type: 'tool_result', isError: false, chars: 4 },
    { type: 'tool_result', isError: true, parts: [{ type: 'text', chars: 2 }, { type: 'image', source: 'base64', mediaType: 'image/png', chars: 4 }] },
    { type: 'document', source: 'base64', mediaType: 'application/pdf', chars: 6 },
    { type: 'tool_use', name: 'Bash', inputChars: JSON.stringify({ command: 'ls' }).length },
    { type: 'thinking', chars: 3 },
    { type: 'redacted_thinking', chars: 5 },
  ])
})

test('passes the row on unchanged', async ($, on) => {
  const w = world(on)
  const input = row({ content: [{ type: 'text', text: 'keep me' }, { type: 'text', text: 'and me' }] })
  await $.session.append(input)

  const stored = w.session.appended()
  expect(stored.length).toBe(1)
  expect(stored[0]?.message.content).toEqual(input.message.content)
  expect(stored[0]?.door).toBe('prompt')
})

test('records subagent rows with their agentId, and queue records (spec 6)', async ($, on) => {
  const w = world(on)
  await $.session.append(row({ uuid: 'u-1', agentId: 'agent-1', door: 'tool-result', origin: { kind: 'tool', tool: 'Grep' }, content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] }))
  await $.session.append(row({ uuid: 'u-2', door: 'queue' }))

  const lines = rowLines(w)
  expect(lines.map(l => [l.door, l.agentId])).toEqual([['tool-result', 'agent-1'], ['queue', undefined]])
})

test('lines add up across rows, and a reload keeps what the file already holds', async ($, on) => {
  const earlier = JSON.stringify({ kind: 'row', seq: 1, door: 'prompt' }) + '\n'
  const w = world(on, { existing: earlier })
  await $.session.append(row({ uuid: 'u-1' }))
  await $.session.append(row({ uuid: 'u-2' }))
  await $.session.append(row({ uuid: 'u-3' }))

  const lines = lastLines(w)
  expect(lines[0]).toEqual({ kind: 'row', seq: 1, door: 'prompt' })
  expect(rowLines(w).slice(1).map(l => l.uuid)).toEqual(['u-1', 'u-2', 'u-3'])
})

test('failure: when the log cannot be written, the row is still stored and nothing throws', async ($, on) => {
  const w = world(on, { failWrites: true })
  await $.session.append(row({ uuid: 'u-1' }))
  await $.session.append(row({ uuid: 'u-2' }))

  expect(w.session.appended().map(r => r.uuid)).toEqual(['u-1', 'u-2'])
})

test('failure: a log that exists but cannot be read back is never overwritten', async ($, on) => {
  const w = world(on, { existing: 'x\n', failRead: true })
  await $.session.append(row({ uuid: 'u-1' }))
  await $.session.append(row({ uuid: 'u-2' }))

  expect(w.writes.length).toBe(2)
  for (const write of w.writes) {
    expect(write.path === LOG_PATH).toBe(false)
    expect(write.path).toMatch(/sess-0001-\d+\.jsonl$/)
  }
  expect(rowLines(w).map(l => l.uuid)).toEqual(['u-1', 'u-2'])
})

test('failure: an unknown block kind or odd identifier records nothing but a safe label', async ($, on) => {
  const w = world(on)
  await $.session.append(row({
    door: 'hook-context',
    origin: { kind: 'hook', event: 'PostToolUse' },
    message: { type: 'user', name: `weird ${FAKE}!`, role: 'user', content: [{ type: 'server_widget', payload: FAKE }, { type: `bad type ${FAKE}`, x: 1 }] },
  }))

  const line = rowLines(w)[0]
  expect(line?.blocks).toEqual([{ type: 'server_widget' }, { type: '(odd)' }])
  expect(line?.name).toBe('(odd)')
  expect(line?.origin).toEqual({ kind: 'hook', event: 'PostToolUse' })
})

test('session.start writes a header with the engine version, surface and interactive flag', async ($, on) => {
  const w = world(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

  expect(w.writes.at(-1)?.path).toBe(LOG_PATH)
  expect(lastLines(w)[0]).toEqual(expect.objectContaining({
    kind: 'start',
    probe: '0.2.0',
    engine: '2.1.316',
    surface: 'terminal',
    interactive: true,
  }))
})
