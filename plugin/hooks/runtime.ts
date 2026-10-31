// The plugin's working parts: settings, checker, redactor. Built lazily by `ready($)`, which every
// hook calls, so nothing depends on `session.start` having run (queue rows arrive before it) or on the
// module's variables surviving (a hooks worker killed at the 6 s mark starts over; the session's
// catches are kept in $.state and the registered secrets are read again from the OS store).

import type { EngineInterface } from 'claude-code'
import { createChecker } from './lib/checker/index.ts'
import type { Rejection } from './lib/checker/index.ts'
import { Redactor } from './lib/core/session.ts'
import type { CatchEntry } from './lib/core/session.ts'
import { checkerOptions, compileAllow, DEFAULTS, resolveSettings, type Settings, type SourceName } from './lib/core/settings.ts'
import type { SecretEntry } from './lib/core/store.ts'
import { loadRegisteredSecrets } from './backends.ts'
import { warn } from './warn.ts'

export type Runtime = {
  settings: Settings
  redactor: Redactor
  /** Plain-words problems with the settings, shown once per change. */
  problems: string[]
  /** Informational notices (settings that do nothing yet, ignored project settings). */
  notices: string[]
  key: string
  savedVersion: number
}

const REFRESH_MS = 10_000
const MAX_TOOL_FILES = 1000

let current: Runtime | undefined
let building: Promise<Runtime> | undefined
let loadedAt = Number.NEGATIVE_INFINITY
let registered: SecretEntry[] | undefined
let reported = ''
const toolFiles = new Map<string, string>()

const SOURCES = ['policy', 'user', 'project', 'local', 'flag'] as const

async function readSources($: EngineInterface): Promise<{ sources: Partial<Record<SourceName, unknown>>; unreadable: string[] }> {
  const sources: Partial<Record<SourceName, unknown>> = {}
  const unreadable: string[] = []
  for (const name of SOURCES) {
    try {
      const all = (await $.settings.read({ source: name })) as Record<string, unknown>
      sources[name] = all.secretShield
    } catch {
      unreadable.push(name)
    }
  }
  return { sources, unreadable }
}

/** Settings from the files alone, with no checker: for a `.catch`, which has one second. */
export async function failureMode($: EngineInterface): Promise<'allow' | 'hold'> {
  if (current) return current.settings.on_check_failure
  try {
    const { sources } = await readSources($)
    return resolveSettings(sources).settings.on_check_failure
  } catch {
    return DEFAULTS.on_check_failure
  }
}

/** The last good settings keep the user's rules but not their `allow` values: nothing a person marked harmless is stored. */
function forStore(s: Settings): Settings {
  return { ...s, allow: s.allow.filter(a => typeof a !== 'string') }
}

async function readCatches($: EngineInterface): Promise<CatchEntry[]> {
  try {
    const { value } = await $.state.get({ plugin: 'secret-shield', key: 'catches' })
    return Array.isArray(value) ? (value as CatchEntry[]) : []
  } catch {
    return []
  }
}

async function build($: EngineInterface): Promise<Runtime> {
  let lastGood: Settings | undefined
  try {
    lastGood = (await $.store.get('lastGood')) as Settings | undefined
  } catch {
    lastGood = undefined
  }
  const { sources, unreadable } = await readSources($)
  const resolved = resolveSettings(sources, lastGood ? { lastGood } : {})
  const key = JSON.stringify(resolved.settings)
  const problems = [...resolved.errors, ...unreadable.map(n => `${n}: the settings could not be read`)]
  if (resolved.ok) {
    try {
      const saved = JSON.stringify(forStore(resolved.settings))
      if (!lastGood || JSON.stringify(lastGood) !== saved) await $.store.set('lastGood', forStore(resolved.settings))
    } catch {
      // Keeping the last good settings is a convenience.
    }
  }

  const now = await $.clock.now()
  let runtime: Runtime
  if (current && current.key === key) {
    runtime = { ...current, problems, notices: resolved.notices }
  } else {
    const { allow, errors: allowErrors } = compileAllow(resolved.settings.allow)
    const { checker, errors: ruleErrors } = createChecker(checkerOptions(resolved.settings))
    problems.push(...allowErrors, ...ruleErrors.map((r: Rejection) => `custom rule ${r.id} refused: ${r.reason}`))
    // Read once per worker: the store can take a second, and a restarted worker reads it again.
    if (registered === undefined) registered = await loadRegisteredSecrets($)
    const redactor = new Redactor({ checker, registered, hints: resolved.settings.hints === 'on', allow })
    redactor.importCatches(current ? current.redactor.exportCatches() : await readCatches($))
    runtime = { settings: resolved.settings, redactor, problems, notices: resolved.notices, key, savedVersion: redactor.persistVersion }
  }
  current = runtime
  loadedAt = now

  const signature = JSON.stringify([problems, resolved.notices])
  if (signature !== reported) {
    reported = signature
    for (const p of problems) warn($, 'settings', `${p}. The last good settings are in use.`)
    if (resolved.settings.notices === 'on') for (const n of resolved.notices) warn($, 'settings-notice', n)
  }
  return runtime
}

/** The working parts, built on first use and refreshed every few seconds so a settings change is picked up. */
export async function ready($: EngineInterface): Promise<Runtime> {
  const now = await $.clock.now()
  if (current && now - loadedAt < REFRESH_MS) return current
  if (!building) {
    building = build($).finally(() => {
      building = undefined
    })
  }
  return building
}

/** Keeps the session's catches and tags in the host's memory, so a restarted worker has them. */
export async function saveCatches($: EngineInterface, rt: Runtime): Promise<void> {
  if (rt.redactor.persistVersion === rt.savedVersion) return
  rt.savedVersion = rt.redactor.persistVersion
  try {
    await $.state.set({ plugin: 'secret-shield', key: 'catches' }, rt.redactor.exportCatches())
  } catch {
    // Not fatal: the next row tries again.
  }
}

/**
 * Remembers which file a Read names, so its tool_result is checked with that file name. Read only: a
 * known source file gets laxer code checks, and no other tool's output is that file's text.
 */
export function rememberToolFile(id: string, tool: unknown, input: unknown): void {
  if (tool !== 'Read' || typeof input !== 'object' || input === null) return
  const file = (input as Record<string, unknown>).file_path
  if (typeof file !== 'string') return
  toolFiles.set(id, file)
  if (toolFiles.size > MAX_TOOL_FILES) {
    const oldest = toolFiles.keys().next().value
    if (oldest !== undefined) toolFiles.delete(oldest)
  }
}

export const fileOfTool = (id: string): string | undefined => toolFiles.get(id)
