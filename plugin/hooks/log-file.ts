// Writing the log (spec §16). $.fs.write replaces the whole file, so each file's text is held here and
// rewritten on every batch, one write at a time. A reload starts over and reads the file back.
// Failures are swallowed after one warning: the log must never get in the way of a row being stored.

import type { EngineInterface } from 'claude-code'
import { appendLine, formatLine, logFileName, staleLogs, type LogEntry } from './lib/core/log.ts'
import { dataDir, joinPath } from './paths.ts'
import { warn } from './warn.ts'

type Open = { path: string; text: string; part: number }

const open = new Map<string, Open>()
let queue: Promise<void> = Promise.resolve()

const today = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

async function openFile($: EngineInterface, date: string, session: string): Promise<Open> {
  const key = `${date}/${session}`
  const held = open.get(key)
  if (held) return held
  const dir = await dataDir($)
  let part = 1
  // Resume the last part a reload left behind.
  while (await $.fs.exists(joinPath(dir, ...logFileName(date, session, part + 1).split('/')))) part++
  const path = joinPath(dir, ...logFileName(date, session, part).split('/'))
  let text = ''
  try {
    if (await $.fs.exists(path)) text = String(await $.fs.read(path))
  } catch {
    // Too big to read back: start the next part rather than overwrite it.
    part++
  }
  const file = { path: joinPath(dir, ...logFileName(date, session, part).split('/')), text, part }
  open.set(key, file)
  return file
}

/** `clean` removes anything secret from text that comes from outside (a file path, a command). */
export function writeLog($: EngineInterface, entries: LogEntry[], clean: (text: string) => string): Promise<void> {
  queue = queue.then(async () => {
    try {
      const ms = entries[0]?.t ?? (await $.clock.now())
      const session = await $.session.id()
      const date = today(ms)
      let file = await openFile($, date, session)
      for (const entry of entries) {
        const added = appendLine(file.text, formatLine(entry, clean))
        if (added.rollover) {
          await $.fs.write(file.path, file.text)
          const dir = await dataDir($)
          file = { path: joinPath(dir, ...logFileName(date, session, file.part + 1).split('/')), text: added.text, part: file.part + 1 }
          open.set(`${date}/${session}`, file)
        } else {
          file.text = added.text
        }
      }
      await $.fs.write(file.path, file.text)
    } catch {
      warn($, 'log', 'could not write its log file')
    }
  })
  return queue
}

/** The mod can't delete a file, so an old log is emptied: its content is gone, and only its name stays. */
export async function pruneLogs($: EngineInterface, days: number): Promise<void> {
  try {
    const dir = joinPath(await dataDir($), 'log')
    if (!(await $.fs.exists(dir))) return
    const entries = await $.fs.list(dir)
    const stale = staleLogs(entries.filter(e => e.kind === 'file' && e.size > 0).map(e => e.name), today(await $.clock.now()), days)
    for (const name of stale) await $.fs.write(joinPath(dir, name), '')
  } catch {
    // Retention is housekeeping.
  }
}
