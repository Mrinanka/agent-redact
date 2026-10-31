// Step 0 probe: writes one JSON line per session.append row to
// <session cwd>/.step0-probe/<session id>.jsonl, with the row's door, kinds,
// ids and sizes. Never content (see summarize.ts).
//
// Load it with: claude --plugin-dir <repo>/experiments/step0-probe

import type { EngineInterface, Register } from 'claude-code'
import { summarizeRow } from './summarize.ts'

const PROBE_VERSION = '0.1.0'
const LOG_DIR = '.step0-probe'

// $.fs.write replaces the whole file, so each log's lines are kept here and the
// file is rewritten on each row. A reload starts this over and reads the file back.
const buffers = new Map<string, { path: string; lines: string[] }>()
let queue: Promise<void> = Promise.resolve()
let seq = 0
let hasWarned = false

// No Node in a mod, so no path.join: use the separator the cwd already uses.
function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

async function logPath($: EngineInterface): Promise<string> {
  const [cwd, sessionId] = await Promise.all([$.session.cwd(), $.session.id()])
  const safeId = /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? sessionId : 'unknown-session'
  return joinPath(cwd, LOG_DIR, `${safeId}.jsonl`)
}

async function loadBuffer($: EngineInterface, path: string): Promise<{ path: string; lines: string[] }> {
  const held = buffers.get(path)
  if (held) return held
  let lines: string[] = []
  let target = path
  if (await $.fs.exists(path)) {
    try {
      const text = await $.fs.read(path)
      lines = String(text).split('\n').filter(l => l !== '')
    } catch {
      // Exists but can't be read back (over 4 MiB, say): never overwrite it.
      target = path.replace(/\.jsonl$/, `-${await $.clock.now()}.jsonl`)
    }
  }
  const buffer = { path: target, lines }
  buffers.set(path, buffer)
  return buffer
}

// Appends one line, one write at a time. Failures are swallowed: the probe
// must never get in the way of a row being stored.
function append($: EngineInterface, line: object): Promise<void> {
  queue = queue.then(async () => {
    try {
      const { path, lines } = await loadBuffer($, await logPath($))
      lines.push(JSON.stringify(line))
      await $.fs.write(path, lines.join('\n') + '\n')
    } catch (err) {
      if (!hasWarned) {
        hasWarned = true
        $.ui.log(`step0-probe: could not write its log (${err instanceof Error ? err.name : 'error'})`, { to: 'debug' })
      }
    }
  })
  return queue
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    const v = await $.session.version().catch(() => undefined)
    await append($, {
      kind: 'start',
      probe: PROBE_VERSION,
      t: await $.clock.now(),
      engine: v?.version ?? 'unknown',
      surface: e.surface,
      interactive: e.isInteractive,
    })
    return out
  })

  on('session.append', async ($, e, next) => {
    const out = await next(e)
    seq += 1
    await append($, summarizeRow(e, seq, await $.clock.now()))
    return out
  }).catch(($, e, next) => next(e))
}
