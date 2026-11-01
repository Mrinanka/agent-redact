// Settings for the backup lock (spec §14). The mod asks Claude Code for each source; a settings hook has
// no such call, so the files are read here: user, project, local and managed (`managed-settings.json`,
// then `managed-settings.d/*.json` in alphabetical order), plus `--policy <file>` for a managed setting
// that arrives by MDM or from the server, which a process can't read. The levels and the "stricter only"
// rules are the main lock's own (`resolveSettings`).
//
// A `--settings` flag is not visible from a hook, so a setting given only that way is not seen.

import fs from 'node:fs'
import path from 'node:path'
import { resolveSettings, type Resolved, type Settings, type SourceName } from '../core/settings.ts'

export type SettingsIO = {
  /** The file's text, undefined when it is not there; throws when it is there and can't be read. */
  read(file: string): string | undefined
  /** File names in a folder, undefined when the folder is not there. */
  list(dir: string): string[] | undefined
}

export const nodeSettingsIO: SettingsIO = {
  read(file) {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
  },
  list(dir) {
    try {
      return fs.readdirSync(dir)
    } catch {
      return undefined
    }
  },
}

export type SettingsRequest = {
  configDir: string
  cwd: string
  platform: NodeJS.Platform
  policyFiles: readonly string[]
  io: SettingsIO
}

export type LoadedSettings = { settings: Settings; problems: string[]; notices: string[]; resolved: Resolved }

const MAX_FILE_BYTES = 1024 * 1024
/** Handed to `resolveSettings` for a source that could not be read: it is not an object, so the source is reported as broken. */
const BROKEN = '(unreadable)'

/** Where the system-wide managed settings live (docs: managed-settings). */
export function managedLocation(platform: NodeJS.Platform): { dir: string; file: string } {
  const dir = platform === 'win32' ? 'C:\\Program Files\\ClaudeCode' : platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code'
  return { dir, file: path.join(dir, 'managed-settings.json') }
}

type Read = { found: false } | { found: true; value: unknown } | { found: true; broken: true }

function readSettingsFile(io: SettingsIO, file: string): Read {
  try {
    const text = io.read(file)
    if (text === undefined) return { found: false }
    if (text.length > MAX_FILE_BYTES) return { found: true, broken: true }
    const doc = JSON.parse(text) as unknown
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { found: true, broken: true }
    return { found: true, value: (doc as Record<string, unknown>).aegisContext }
  } catch {
    return { found: true, broken: true }
  }
}

/** Later files win, setting by setting. The `locked` list is the policy's own, so a later file's list replaces an earlier one. */
function mergePolicy(parts: unknown[]): unknown {
  const present = parts.filter(p => p !== undefined && p !== null)
  if (present.length === 0) return undefined
  if (present.some(p => typeof p !== 'object' || Array.isArray(p))) return BROKEN
  return Object.assign({}, ...present)
}

export function loadBackupSettings(req: SettingsRequest): LoadedSettings {
  const { io } = req
  const sources: Partial<Record<SourceName, unknown>> = {}
  const extra: string[] = []
  const one = (name: SourceName, file: string): void => {
    const r = readSettingsFile(io, file)
    if (r.found) sources[name] = 'broken' in r ? BROKEN : r.value
  }
  one('user', path.join(req.configDir, 'settings.json'))
  one('project', path.join(req.cwd, '.claude', 'settings.json'))
  one('local', path.join(req.cwd, '.claude', 'settings.local.json'))

  // Managed: the system file, its drop-ins in order, then every --policy file.
  const m = managedLocation(req.platform)
  const policyParts: unknown[] = []
  let policyBroken = false
  const addPolicy = (file: string, required: boolean): void => {
    const r = readSettingsFile(io, file)
    if (!r.found) {
      if (required) policyBroken = true
      return
    }
    if ('broken' in r) policyBroken = true
    else policyParts.push(r.value)
  }
  addPolicy(m.file, false)
  const drops = (io.list(m.dir) ?? []).filter(n => n.endsWith('.json') && !n.startsWith('.') && n !== 'managed-settings.json').sort()
  for (const name of drops) addPolicy(path.join(m.dir, name), false)
  for (const file of req.policyFiles) addPolicy(file, true)
  const policy = policyBroken ? BROKEN : mergePolicy(policyParts)
  if (policy !== undefined) sources.policy = policy

  const resolved = resolveSettings(sources)
  const problems = [...resolved.errors, ...extra]
  let settings = resolved.settings
  // An organization's file that can't be read or understood is not a reason to let things through.
  if (policyBroken || problems.some(p => p.startsWith('policy:'))) {
    settings = { ...settings, on_check_failure: 'hold' }
    if (policyBroken && !problems.some(p => p.startsWith('policy:'))) problems.push('policy: a managed settings file could not be read')
  }
  return { settings, problems, notices: resolved.notices, resolved }
}
