// Tests for the probe's opt-in check modules (hooks/checks/). Run with:
//   claude plugin test ./experiments/step0-probe
//
// Each check is off unless its marker file <cwd>/.step0-probe/on-<name> exists.
// Every test plants a canary and asserts it reaches no write.

import type { On, SessionAppendInput, SessionStartInput, TurnStepResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Built from pieces: never written whole in the repo.
const CANARY = ['CANARY', '0f1e2d3c4b5a6978'].join('-')

const CWD = 'D:\\work\\scratch'
const SESSION = 'sess-0002'
const LOG_PATH = `${CWD}\\.step0-probe\\${SESSION}.jsonl`
const marker = (name: string) => `${CWD}\\.step0-probe\\on-${name}`

type Write = { path: string; text: string }
type Run = { argv: readonly string[]; stdin?: string }

type Opts = {
  markers?: string[]
  files?: Record<string, string>
  failWritesTo?: RegExp
  run?: (argv: readonly string[]) => { exitCode: number; stdout: string } | Error
  messages?: { role: 'user' | 'assistant'; text: string }[]
}

function world(on: On, opts: Opts = {}) {
  const writes: Write[] = []
  const runs: Run[] = []
  const on_ = new Set((opts.markers ?? []).map(marker))
  mock.clock(on, { now: 2_000 })
  on('session.id', () => ({ value: SESSION }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.version', () => ({ value: { version: '2.1.316', base: '2.1.316' } }))
  on('fs.exists', (_$, e) => ({ value: on_.has(e.path) || (opts.files ?? {})[e.path] !== undefined }))
  on('fs.read', (_$, e) => {
    const text = (opts.files ?? {})[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    if (opts.failWritesTo?.test(e.path)) throw new Error('EACCES')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const out = opts.run?.(e.argv) ?? new Error('ENOENT')
    if (out instanceof Error) throw out
    return { value: { ...out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.messages', () => ({
    value: (opts.messages ?? []).map(m => ({ role: m.role, text: m.text, toolUses: [] })),
  }))
  const session = mock.session(on)
  return { writes, runs, session }
}

function checkLines(writes: Write[]): Record<string, unknown>[] {
  const last = [...writes].reverse().find(w => w.path === LOG_PATH)
  if (!last) return []
  return last.text.split('\n').filter(l => l !== '').map(l => JSON.parse(l) as Record<string, unknown>).filter(l => l.kind === 'check')
}

function noCanary(writes: Write[], extra: string[] = []): void {
  for (const w of writes) {
    expect(w.text.includes(CANARY)).toBe(false)
    for (const x of extra) expect(w.text.includes(x)).toBe(false)
  }
}

function row(content: SessionAppendInput['message']['content'], door: SessionAppendInput['door'] = 'prompt'): SessionAppendInput {
  return {
    door,
    origin: { kind: 'composer' },
    uuid: 'u-1',
    message: { type: 'user', role: 'user', content },
  } as SessionAppendInput
}

async function start($: { session: { start: (input: SessionStartInput) => Promise<unknown> } }, on: On): Promise<void> {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
}

// ---- off by default -------------------------------------------------------

test('every check is off without its marker: mention, media and turn.step pass through untouched', async ($, on) => {
  const w = world(on, { run: () => ({ exitCode: 0, stdout: 'x' }) })
  const seen: string[] = []
  on('prompt.mention', (_$, e) => { seen.push(e.path); return { type: 'file' } })
  let steps = 0
  on('turn.step', async function* (_$, e) {
    steps += 1
    return { turnId: e.turnId, index: e.index, answer: 'model', toolUses: [], stopReason: 'end_turn', usage: null } as TurnStepResult
  })
  await start($, on)
  await $.prompt.mention({ mention: 'a.txt', path: `${CWD}\\a.txt` })
  const content = [{ type: 'text', text: 'hi' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]
  await $.session.append(row(content as SessionAppendInput['message']['content']))
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })
  for await (const _ of stream) { /* drain */ }

  expect(seen).toEqual([`${CWD}\\a.txt`])
  expect(w.session.appended()[0]?.message.content).toEqual(content)
  expect(steps).toBe(1)
  expect(w.runs).toEqual([])
  expect(checkLines(w.writes)).toEqual([])
})

// ---- 0.2 mention ----------------------------------------------------------

test('0.2: a mention is redirected to a redacted copy; the canary reaches no write', async ($, on) => {
  const original = `${CWD}\\notes.txt`
  const w = world(on, { markers: ['mention'], files: { [original]: `line 1\r\ntoken ${CANARY}\nfin ✓` } })
  const seen: string[] = []
  on('prompt.mention', (_$, e) => { seen.push(e.path); return { type: 'file' } })
  await start($, on)
  const out = await $.prompt.mention({ mention: 'notes.txt', path: original })

  expect(out.type).toBe('file')
  expect(seen.length).toBe(1)
  expect(seen[0]).toMatch(/\\\.step0-probe\\mention-copy-\d+\.txt$/)
  const copy = w.writes.find(x => x.path === seen[0])
  expect(copy?.text).toBe('line 1\r\ntoken [HIDDEN]\nfin ✓')
  expect(checkLines(w.writes)).toEqual([expect.objectContaining({ check: '0.2', step: 'redirect', redirected: true, attached: 'file', hadCanary: true })])
  noCanary(w.writes)
})

test('0.2 failure: when the redacted copy cannot be written, the mention is refused (fails closed)', async ($, on) => {
  const original = `${CWD}\\notes.txt`
  const w = world(on, { markers: ['mention'], files: { [original]: `t ${CANARY}` }, failWritesTo: /mention-copy/ })
  const seen: string[] = []
  on('prompt.mention', (_$, e) => { seen.push(e.path); return { type: 'file' } })
  await start($, on)
  const out = await $.prompt.mention({ mention: 'notes.txt', path: original })

  expect('deny' in out && typeof out.deny === 'string').toBe(true)
  expect(seen).toEqual([])
  noCanary(w.writes)
})

// ---- 0.3 resume -----------------------------------------------------------

test('0.3: logs what $.session.messages() holds at session.start as counts, never text', async ($, on) => {
  const w = world(on, {
    markers: ['resume'],
    messages: [
      { role: 'user', text: `my key ${CANARY}` },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: 'next' },
    ],
  })
  await start($, on)

  expect(checkLines(w.writes)).toEqual([expect.objectContaining({ check: '0.3', at: 'session.start', n: 3, user: 2, assistant: 1, hasCanary: true })])
  noCanary(w.writes)
})

test('0.3: with on-resume-hold, the first main request is held (no next) and the second goes through', async ($, on) => {
  const w = world(on, { markers: ['resume', 'resume-hold'] })
  let steps = 0
  on('turn.step', async function* (_$, e) {
    steps += 1
    return { turnId: e.turnId, index: e.index, answer: 'model', toolUses: [], stopReason: 'end_turn', usage: null } as TurnStepResult
  })
  await start($, on)
  const first = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 4 })
  for await (const _ of first) { /* drain */ }
  // Not asserted: first.result, which resolves undefined under `claude plugin test`
  // even when beneath answers (progress.md, Known issues).
  const second = $.turn.step({ turnId: 't1', index: 1, model: 'm', messageCount: 5 })
  for await (const _ of second) { /* drain */ }

  expect(steps).toBe(1)
  expect(checkLines(w.writes).filter(l => l.at === 'turn.step')).toEqual([expect.objectContaining({ check: '0.3', at: 'turn.step', held: true, messageCount: 4 })])
})

// ---- 0.4 / 0.13 runtime ----------------------------------------------------

test('0.4/0.13: records WebCrypto, DPAPI round trip and node version as labels; the round-trip value reaches no write', async ($, on) => {
  const w = world(on, {
    markers: ['runtime'],
    run: argv => {
      if (argv[0] === 'powershell') return { exitCode: 0, stdout: 'roundtrip-ok\r\n' }
      if (argv[0] === 'node') return { exitCode: 0, stdout: 'v24.22.1\n' }
      return new Error('ENOENT')
    },
  })
  await start($, on)

  const lines = checkLines(w.writes)
  expect(lines).toEqual(expect.arrayContaining([
    // The mod runtime's crypto.subtle has digest only (claude-code.d.ts:16030, 2.1.316): no AES-GCM.
    expect.objectContaining({ check: '0.4', subtle: false, aesGcm: false, random: true, dpapi: 'roundtrip-ok', security: 'missing', secretTool: 'missing' }),
    expect.objectContaining({ check: '0.13', node: 'v24.22.1' }),
  ]))
  const stdins = w.runs.map(r => r.stdin).filter((s): s is string => typeof s === 'string' && s !== '')
  expect(stdins.length).toBeGreaterThan(0)
  noCanary(w.writes, stdins)
})

test('0.4 failure: no OS password store and no node: every probe says missing, and session.start still finishes', async ($, on) => {
  const w = world(on, { markers: ['runtime'], run: () => new Error('ENOENT') })
  await start($, on)

  const lines = checkLines(w.writes)
  expect(lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ check: '0.4', dpapi: 'missing', security: 'missing', secretTool: 'missing' }),
    expect.objectContaining({ check: '0.13', node: 'missing' }),
  ]))
})

test('0.4: odd process output is recorded as a safe label, never as text', async ($, on) => {
  const w = world(on, { markers: ['runtime'], run: () => ({ exitCode: 0, stdout: `leak ${CANARY}` }) })
  await start($, on)

  const lines = checkLines(w.writes)
  expect(lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ check: '0.4', dpapi: '(odd)' }),
    expect.objectContaining({ check: '0.13', node: '(odd)' }),
  ]))
  noCanary(w.writes)
})

// ---- 0.5 media -----------------------------------------------------------

test('0.5: image and document blocks are dropped, at top level and inside tool results; text is untouched', async ($, on) => {
  const w = world(on, { markers: ['media'] })
  await start($, on)
  await $.session.append(row([
    { type: 'text', text: 'keep' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    { type: 'tool_result', tool_use_id: 't1', content: [
      { type: 'text', text: 'also keep' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } },
    ] },
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'CCCC' } },
  ] as SessionAppendInput['message']['content'], 'tool-result'))

  const stored = JSON.stringify(w.session.appended()[0]?.message.content)
  expect(stored.includes('"image"')).toBe(false)
  expect(stored.includes('"document"')).toBe(false)
  expect(stored.includes('keep')).toBe(true)
  expect(stored.includes('also keep')).toBe(true)
  expect(stored.includes('media dropped')).toBe(true)
  expect(checkLines(w.writes)).toEqual([expect.objectContaining({ check: '0.5', door: 'tool-result', dropped: 3 })])
})

// ---- 0.6 budget -----------------------------------------------------------

test('0.6: a throwing hook is caught; the .catch logs the failure and the row is still stored', async ($, on) => {
  const w = world(on, { markers: ['budget'] })
  await start($, on)
  await $.session.append(row([{ type: 'text', text: 'please BUDGET-THROW now' }]))

  expect(w.session.appended().length).toBe(1)
  expect(checkLines(w.writes)).toEqual([expect.objectContaining({ check: '0.6', step: 'caught', failure: 'throw' })])
})

// ---- 0.10 hide ------------------------------------------------------------

test('0.10: with on-hide, canaries in text and tool results are replaced by [HIDDEN] before the row is stored', async ($, on) => {
  const w = world(on, { markers: ['hide'] })
  await start($, on)
  await $.session.append(row([
    { type: 'text', text: `see ${CANARY}\r\nend ✓` },
    { type: 'tool_result', tool_use_id: 't1', content: `out ${CANARY}` },
    { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: `x ${CANARY} y` }] },
  ] as SessionAppendInput['message']['content'], 'tool-result'))

  const stored = JSON.stringify(w.session.appended()[0]?.message.content)
  expect(stored.includes(CANARY)).toBe(false)
  expect(stored.split('[HIDDEN]').length - 1).toBe(3)
  expect(stored.includes('end ✓')).toBe(true)
  expect(checkLines(w.writes)).toEqual([expect.objectContaining({ check: '0.10', door: 'tool-result', hidden: 3 })])
  noCanary(w.writes)
})

test('0.10: without on-hide, a canary row is stored unchanged', async ($, on) => {
  const w = world(on)
  await start($, on)
  const content = [{ type: 'text', text: `see ${CANARY}` }] as SessionAppendInput['message']['content']
  await $.session.append(row(content))

  expect(w.session.appended()[0]?.message.content).toEqual(content)
  noCanary(w.writes)
})
