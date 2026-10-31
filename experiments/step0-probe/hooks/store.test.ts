// Tests for the password store check (hooks/checks/store.ts). Run with:
//   claude plugin test ./experiments/step0-probe
//
// The check does a real round trip through each OS password store (check 0.4,
// D-023). Each store is simulated here. The stored text must reach no write.

import type { On, SessionStartInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const CWD = 'D:\\work\\scratch'
const SESSION = 'sess-0003'
const LOG_PATH = `${CWD}\\.step0-probe\\${SESSION}.jsonl`
const MARKER = `${CWD}\\.step0-probe\\on-store`

type Reply = { exitCode: number; stdout: string; stderr?: string; isStdoutTruncated?: boolean } | Error
type Call = { argv: readonly string[]; stdin?: string }

function world(on: On, opts: { marker?: boolean; run: (c: Call) => Reply }) {
  const writes: { path: string; text: string }[] = []
  const calls: Call[] = []
  mock.clock(on, { now: 2_000 })
  on('session.id', () => ({ value: SESSION }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.version', () => ({ value: { version: '2.1.316', base: '2.1.316' } }))
  on('fs.exists', (_$, e) => ({ value: opts.marker !== false && e.path === MARKER }))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('fs.write', (_$, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const call = { argv: e.argv, stdin: e.init?.stdin }
    calls.push(call)
    const out = opts.run(call)
    if (out instanceof Error) throw out
    return { value: { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...out } }
  })
  return { writes, calls }
}

async function start($: { session: { start: (input: SessionStartInput) => Promise<unknown> } }, on: On): Promise<void> {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
}

type Line = { check: string; store: string; method: string; bytes: number; result: string; exit?: number; reason?: string }

function lines(writes: { path: string; text: string }[]): Line[] {
  const last = [...writes].reverse().find(w => w.path === LOG_PATH)
  if (!last) return []
  return last.text.split('\n').filter(l => l !== '').map(l => JSON.parse(l) as Record<string, unknown>).filter(l => l.check === 'store') as unknown as Line[]
}

const of = (ls: Line[], store: string, method: string) => ls.filter(l => l.store === store && l.method === method)

function noValue(writes: { text: string }[], values: string[]): void {
  for (const w of writes) for (const v of values) expect(w.text.includes(v)).toBe(false)
}

const missing = () => new Error('ENOENT')

test('off without its marker: no store is touched', async ($, on) => {
  const w = world(on, { marker: false, run: missing })
  await start($, on)
  expect(w.calls.some(c => ['powershell', 'security', 'secret-tool'].includes(c.argv[0] ?? ''))).toBe(false)
})

test('nothing installed: each store is reported missing once, not per size', async ($, on) => {
  const w = world(on, { run: missing })
  await start($, on)
  const ls = lines(w.writes)
  expect(ls.map(l => `${l.store}/${l.method}/${l.result}`).sort()).toEqual([
    'dpapi/stdin/missing',
    'keychain/argv/missing',
    'keychain/interactive/missing',
    'secret-service/stdin/missing',
  ])
})

test('DPAPI: round trips at 1 KB, 64 KB and 1 MB, through stdin, and logs no value', async ($, on) => {
  const seen: string[] = []
  const w = world(on, {
    run: c => {
      if (c.argv[0] !== 'powershell') return missing()
      seen.push(c.stdin ?? '')
      return { exitCode: 0, stdout: 'roundtrip-ok\r\n' }
    },
  })
  await start($, on)
  const ls = of(lines(w.writes), 'dpapi', 'stdin')
  expect(ls.map(l => [l.bytes, l.result])).toEqual([[1024, 'ok'], [65536, 'ok'], [1048576, 'ok']])
  expect(seen.map(s => s.length)).toEqual([1024, 65536, 1048576])
  expect(w.calls.some(c => c.argv.some(a => seen.includes(a)))).toBe(false)
  noValue(w.writes, seen)
})

function keychain() {
  let held: string | undefined
  const deletes: string[] = []
  const run = (c: Call): Reply => {
    if (c.argv[0] !== 'security') return missing()
    if (c.argv[1] === '-i') {
      held = /-w "([^"]*)"/.exec(c.stdin ?? '')?.[1]
      return { exitCode: 0, stdout: '' }
    }
    if (c.argv[1] === 'add-generic-password') {
      held = c.argv[c.argv.indexOf('-w') + 1]
      return { exitCode: 0, stdout: '' }
    }
    if (c.argv[1] === 'find-generic-password') return { exitCode: 0, stdout: `${held}\n` }
    if (c.argv[1] === 'delete-generic-password') {
      deletes.push('x')
      return { exitCode: 0, stdout: '' }
    }
    return new Error('unexpected')
  }
  return { run, deletes, value: () => held ?? '' }
}

test('macOS Keychain: both ways in round trip and clean up after themselves', async ($, on) => {
  const k = keychain()
  const w = world(on, { run: k.run })
  await start($, on)
  const ls = lines(w.writes)
  expect(of(ls, 'keychain', 'argv').map(l => l.result)).toEqual(['ok', 'ok', 'ok'])
  expect(of(ls, 'keychain', 'interactive').map(l => l.result)).toEqual(['ok', 'ok', 'ok'])
  expect(k.deletes.length).toBe(6)
  noValue(w.writes, [k.value()])
})

test('Linux Secret Service: stores through stdin, reads back and clears', async ($, on) => {
  let held = ''
  const verbs: string[] = []
  const w = world(on, {
    run: c => {
      if (c.argv[0] !== 'secret-tool') return missing()
      verbs.push(c.argv[1] ?? '')
      if (c.argv[1] === 'store') held = c.stdin ?? ''
      return { exitCode: 0, stdout: c.argv[1] === 'lookup' ? held : '' }
    },
  })
  await start($, on)
  expect(of(lines(w.writes), 'secret-service', 'stdin').map(l => l.result)).toEqual(['ok', 'ok', 'ok'])
  expect(verbs).toEqual(['store', 'lookup', 'clear', 'store', 'lookup', 'clear', 'store', 'lookup', 'clear'])
  noValue(w.writes, [held])
})

test('no password store: a store tool that fails is "unavailable", with its exit code', async ($, on) => {
  const w = world(on, {
    run: c => (c.argv[0] === 'secret-tool' ? { exitCode: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus without X11' } : missing()),
  })
  await start($, on)
  const [first] = of(lines(w.writes), 'secret-service', 'stdin')
  expect(first?.result).toBe('unavailable')
  expect(first?.exit).toBe(1)
  expect(first?.reason).toBe('Cannot autolaunch D-Bus without X11')
})

test('a value echoed in an error reaches no log', async ($, on) => {
  let stored = ''
  const w = world(on, {
    run: c => {
      if (c.argv[0] !== 'secret-tool') return missing()
      stored = c.stdin ?? stored
      return { exitCode: 2, stdout: '', stderr: `bad item ${c.stdin ?? ''}` }
    },
  })
  await start($, on)
  noValue(w.writes, [stored])
})

test('a wrong value back is "mismatch"; a cut-off one is "truncated"', async ($, on) => {
  let n = 0
  const w = world(on, {
    run: c => {
      if (c.argv[0] !== 'secret-tool') return missing()
      if (c.argv[1] !== 'lookup') return { exitCode: 0, stdout: '' }
      n += 1
      return n === 1 ? { exitCode: 0, stdout: 'something else' } : { exitCode: 0, stdout: 'cut', isStdoutTruncated: true }
    },
  })
  await start($, on)
  expect(of(lines(w.writes), 'secret-service', 'stdin').map(l => l.result)).toEqual(['mismatch', 'truncated', 'truncated'])
})
