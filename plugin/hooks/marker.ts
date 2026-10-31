// The "I'm running" marker (R-04): markers/<session id>.json, holding the start time and plugin version.
// The backup lock reads it (step 5). The mod can't delete a file, so session.end rewrites it as not running.
// It is written again when the session id changes, because /clear raises session.end with no
// session.start after it.

import type { EngineInterface } from 'claude-code'
import { dataDir, joinPath } from './paths.ts'

export const PLUGIN_VERSION = '0.1.0'

let writtenFor: string | undefined

export async function markRunning($: EngineInterface): Promise<void> {
  try {
    const session = await $.session.id()
    if (writtenFor === session) return
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(session)) return
    const started = await $.clock.now()
    await $.fs.write(joinPath(await dataDir($), 'markers', `${session}.json`), JSON.stringify({ running: true, started, version: PLUGIN_VERSION }))
    writtenFor = session
  } catch {
    // Not fatal; the backup lock then treats the session as unprotected and is strict.
  }
}

export async function markEnded($: EngineInterface): Promise<void> {
  try {
    const session = await $.session.id()
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(session)) return
    await $.fs.write(joinPath(await dataDir($), 'markers', `${session}.json`), JSON.stringify({ running: false, ended: await $.clock.now(), version: PLUGIN_VERSION }))
    writtenFor = undefined
  } catch {
    // Same.
  }
}
