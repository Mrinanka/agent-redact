// The "I'm running" marker (R-04): markers/<session id>.json, holding the start time, a `beat` and the plugin
// version. The backup lock reads it (src/backup/marker.ts) and stands down only for `running: true` with a
// fresh beat, because a crash leaves `running: true` behind. The mod can't delete a file, so session.end
// rewrites it as not running. It is written again when the session id changes, because /clear raises
// session.end with no session.start after it.

import type { EngineInterface } from 'claude-code'
import { dataDir, joinPath } from './paths.ts'

export const PLUGIN_VERSION = '0.1.0'

/** How often the beat is refreshed while rows arrive. The backup lock counts a beat fresh for five minutes. */
export const BEAT_MS = 30_000

let writtenFor: string | undefined
let startedAt: number | undefined
let lastBeat = Number.NEGATIVE_INFINITY

export async function markRunning($: EngineInterface, force = false): Promise<void> {
  try {
    const session = await $.session.id()
    if (writtenFor === session && !force) return
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(session)) return
    const now = await $.clock.now()
    const started = writtenFor === session && startedAt !== undefined ? startedAt : now
    await $.fs.write(joinPath(await dataDir($), 'markers', `${session}.json`), JSON.stringify({ running: true, started, beat: now, version: PLUGIN_VERSION }))
    writtenFor = session
    startedAt = started
    lastBeat = now
  } catch {
    // Not fatal; the backup lock then treats the session as unprotected and is strict.
  }
}

/** Called with the time on every use of the plugin: refreshes the beat at most every BEAT_MS, and writes the marker again after a worker restart. */
export async function markAlive($: EngineInterface, now: number): Promise<void> {
  if (writtenFor !== undefined && now - lastBeat < BEAT_MS) return
  await markRunning($, true)
}

export async function markEnded($: EngineInterface): Promise<void> {
  try {
    const session = await $.session.id()
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(session)) return
    await $.fs.write(joinPath(await dataDir($), 'markers', `${session}.json`), JSON.stringify({ running: false, ended: await $.clock.now(), version: PLUGIN_VERSION }))
    writtenFor = undefined
    startedAt = undefined
    lastBeat = Number.NEGATIVE_INFINITY
  } catch {
    // Same.
  }
}
