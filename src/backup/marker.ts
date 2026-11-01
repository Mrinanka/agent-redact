// The "I'm running" marker, read by the backup lock (spec §5.2, R-04). The main lock writes
// <config>/secret-shield/markers/<session id>.json; the backup lock stands down only when it says
// `running: true` with a fresh `beat`. A crash leaves `running: true` behind, so age is what decides.

import fs from 'node:fs'
import path from 'node:path'

export type Marker = { running: boolean; started?: number; beat?: number; ended?: number; version: string }

/** How often the main lock refreshes `beat` while rows arrive (first guess, no measurement behind it). */
export const BEAT_MS = 30_000
/** How old a beat may be and still count (first guess). Missing the main lock costs a stricter backup; missing the backup costs a leak. */
export const FRESH_MS = 5 * 60_000
/** Two clocks on one machine agree; this much is allowed for a rounding difference only. */
const SKEW_MS = 5000
const MAX_MARKER_BYTES = 64 * 1024
export const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

export function isMainLockAlive(m: Marker | null | undefined, now: number): boolean {
  if (m === null || m === undefined || typeof m !== 'object') return false
  if (m.running !== true) return false
  const beat = m.beat
  if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 0) return false
  if (beat > now + SKEW_MS) return false
  return now - beat <= FRESH_MS
}

export function parseMarker(text: string): Marker | undefined {
  try {
    const v = JSON.parse(text) as unknown
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Marker) : undefined
  } catch {
    return undefined
  }
}

/** The marker's path, or nothing for a session id that is not a plain name. */
export function markerPath(configDir: string, sessionId: unknown): string | undefined {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return undefined
  return path.join(configDir, 'secret-shield', 'markers', `${sessionId}.json`)
}

/** Any trouble reading it reads as "no marker", which makes the backup lock act. */
export function readMarker(configDir: string, sessionId: unknown): Marker | undefined {
  const file = markerPath(configDir, sessionId)
  if (file === undefined) return undefined
  try {
    if (fs.statSync(file).size > MAX_MARKER_BYTES) return undefined
    return parseMarker(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}
