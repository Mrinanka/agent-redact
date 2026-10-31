// The probe's log: <session cwd>/.step0-probe/<session id>.jsonl, one JSON
// line per entry. Metadata only (D-017). Imported by register.ts and by the
// check modules: the engine lets `$` pass only to functions declared or
// imported at the top of a file, never to one handed in as a parameter.

import type { EngineInterface } from 'claude-code'
import { LOG_DIR, joinPath } from './checks/common.ts'

// $.fs.write replaces the whole file, so each log's lines are kept here and the
// file is rewritten on each line. A reload starts this over and reads the file back.
const buffers = new Map<string, { path: string; lines: string[] }>()
let queue: Promise<void> = Promise.resolve()
let hasWarned = false

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
export function append($: EngineInterface, line: object): Promise<void> {
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
