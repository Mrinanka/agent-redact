// Settings (spec §14, R-13, R-14, R-15). Pure: the hooks read each source's `secretShield` key and
// hand the values here.
//
// The levels, lowest first:
//   defaults  <  policy (managed)  <  user  <  project, local, flag (each treated as Project)
// Managed settings are the starting point and may `lock` settings; a locked setting keeps its
// managed value (or the default) whatever the user or a project says. The user can change anything
// else. A Project source can only make things stricter. A message never holds a setting's value,
// because an `allow` entry may itself be a secret.

import { convertAllowPattern, type Action, type CheckerOptions, type CustomRuleInput } from '../checker/index.ts'
import type { Allow } from './session.ts'

export type SourceName = 'policy' | 'user' | 'project' | 'local' | 'flag'
export type AllowEntry = string | { pattern: string }

export type Settings = {
  mode: 'enforce' | 'observe'
  personal_data: 'on' | 'off'
  outbound: 'block' | 'ask' | 'warn' | 'off'
  on_check_failure: 'allow' | 'hold'
  media: 'pass' | 'drop'
  hints: 'on' | 'off'
  notices: 'on' | 'off'
  rules: { off: string[]; custom: CustomRuleInput[]; actions: Record<string, Action> }
  allow: AllowEntry[]
  secret_files: string[]
  log: { days: number }
  locked: string[]
}

export const DEFAULTS: Settings = {
  mode: 'enforce',
  personal_data: 'off',
  outbound: 'block',
  on_check_failure: 'allow',
  media: 'pass',
  hints: 'on',
  notices: 'on',
  rules: { off: [], custom: [], actions: {} },
  allow: [],
  secret_files: ['.env*'],
  log: { days: 30 },
  locked: [],
}

export type Resolved = { settings: Settings; errors: string[]; notices: string[]; ok: boolean }

const ENUMS = {
  mode: ['enforce', 'observe'],
  personal_data: ['on', 'off'],
  outbound: ['block', 'ask', 'warn', 'off'],
  on_check_failure: ['allow', 'hold'],
  media: ['pass', 'drop'],
  hints: ['on', 'off'],
  notices: ['on', 'off'],
} as const

type EnumKey = keyof typeof ENUMS

/** How strict a value is: a Project source may only move up. */
const STRICT: Partial<Record<EnumKey, string[]>> = {
  mode: ['observe', 'enforce'],
  personal_data: ['off', 'on'],
  outbound: ['off', 'warn', 'ask', 'block'],
  on_check_failure: ['allow', 'hold'],
  media: ['pass', 'drop'],
  hints: ['on', 'off'],
}
const ACTION_STRICT: Action[] = ['warn', 'hide', 'block']

const LOCK_NAMES = ['mode', 'personal_data', 'outbound', 'on_check_failure', 'media', 'hints', 'notices', 'rules', 'rules.off', 'rules.custom', 'rules.actions', 'allow', 'secret_files', 'log', 'log.days']
const KNOWN = new Set<string>([...Object.keys(ENUMS), 'rules', 'allow', 'secret_files', 'log', 'locked'])
const MAX_ITEMS = 1000

type Patch = {
  enums: Partial<Record<EnumKey, string>>
  off?: string[]
  custom?: CustomRuleInput[]
  actions?: Record<string, Action>
  allow?: AllowEntry[]
  secret_files?: string[]
  days?: number
  locked?: string[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const isStringList = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= MAX_ITEMS && v.every(x => isString(x, max))

function parseSource(name: SourceName, raw: unknown): { patch: Patch; errors: string[]; notices: string[] } {
  const patch: Patch = { enums: {} }
  const errors: string[] = []
  const notices: string[] = []
  if (raw === undefined || raw === null) return { patch, errors, notices }
  const bad = (what: string, wants: string): void => void errors.push(`${name}: ${what} ${wants}`)
  if (!isObject(raw)) {
    bad('secretShield', 'must be an object')
    return { patch, errors, notices }
  }
  for (const key of Object.keys(raw)) if (!KNOWN.has(key)) notices.push(`${name}: unknown setting "${key.slice(0, 40)}" ignored`)

  for (const key of Object.keys(ENUMS) as EnumKey[]) {
    if (!(key in raw)) continue
    const v = raw[key]
    if (typeof v === 'string' && (ENUMS[key] as readonly string[]).includes(v)) patch.enums[key] = v
    else bad(key, `must be one of ${ENUMS[key].join(', ')}`)
  }

  if ('rules' in raw) {
    const rules = raw.rules
    if (!isObject(rules)) bad('rules', 'must be an object')
    else {
      if ('off' in rules) {
        if (isStringList(rules.off, 64)) patch.off = rules.off
        else bad('rules.off', 'must be a list of rule ids')
      }
      if ('custom' in rules) {
        const list = rules.custom
        const okShape = (c: unknown): c is CustomRuleInput =>
          isObject(c) && typeof c.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(c.id) && isString(c.label, 40) && isString(c.keyword, 64) && isString(c.pattern, 1000)
        if (Array.isArray(list) && list.length <= 100 && list.every(okShape)) patch.custom = list.map(c => ({ id: c.id, label: c.label, keyword: c.keyword, pattern: c.pattern }))
        else bad('rules.custom', 'must be a list of { id, label, keyword, pattern }, each a short string (id: lower-case letters, digits and dashes)')
      }
      if ('actions' in rules) {
        const a = rules.actions
        if (isObject(a) && Object.keys(a).length <= MAX_ITEMS && Object.entries(a).every(([k, v]) => k.length <= 64 && (v === 'hide' || v === 'block' || v === 'warn'))) patch.actions = { ...(a as Record<string, Action>) }
        else bad('rules.actions', 'must map rule ids to block, hide or warn')
      }
    }
  }
  if ('allow' in raw) {
    const a = raw.allow
    if (Array.isArray(a) && a.length <= MAX_ITEMS && a.every(x => isString(x, 4096) || (isObject(x) && isString(x.pattern, 1000)))) patch.allow = a.map(x => (typeof x === 'string' ? x : { pattern: (x as { pattern: string }).pattern }))
    else bad('allow', 'must be a list of values or { pattern } entries')
  }
  if ('secret_files' in raw) {
    if (isStringList(raw.secret_files, 256)) patch.secret_files = raw.secret_files
    else bad('secret_files', 'must be a list of file patterns')
  }
  if ('log' in raw) {
    const log = raw.log
    if (isObject(log) && 'days' in log && Number.isInteger(log.days) && (log.days as number) >= 1 && (log.days as number) <= 3650) patch.days = log.days as number
    else bad('log.days', 'must be a whole number of days from 1 to 3650')
  }
  if ('locked' in raw) {
    if (name !== 'policy') notices.push(`${name}: "locked" is ignored; only managed settings can lock`)
    else if (isStringList(raw.locked, 40) && raw.locked.every(n => LOCK_NAMES.includes(n))) patch.locked = [...new Set(raw.locked)]
    else bad('locked', `must be a list of setting names (${LOCK_NAMES.join(', ')})`)
  }
  return { patch, errors, notices }
}

const clone = (s: Settings): Settings => ({ ...s, rules: { off: [...s.rules.off], custom: [...s.rules.custom], actions: { ...s.rules.actions } }, allow: [...s.allow], secret_files: [...s.secret_files], log: { ...s.log }, locked: [...s.locked] })

function expandLocks(names: string[]): Set<string> {
  const out = new Set<string>()
  for (const n of names) {
    if (n === 'rules') ['rules.off', 'rules.custom', 'rules.actions'].forEach(x => out.add(x))
    else if (n === 'log') out.add('log.days')
    else out.add(n)
  }
  return out
}

function notYet(s: Settings): string[] {
  const out: string[] = []
  if (s.personal_data === 'on') out.push('personal_data: on is not available yet; emails and phone numbers are not hidden')
  if (s.media === 'drop') out.push('media: drop is not available yet; images and documents are passed')
  if (s.mode === 'observe') out.push('mode: observe is not available yet; secret-shield keeps hiding secrets')
  return out
}

export function resolveSettings(sources: Partial<Record<SourceName, unknown>>, o: { lastGood?: Settings } = {}): Resolved {
  const errors: string[] = []
  const notices: string[] = []
  const parsed = new Map<SourceName, Patch>()
  for (const name of ['policy', 'user', 'project', 'local', 'flag'] as const) {
    const p = parseSource(name, sources[name])
    notices.push(...p.notices)
    if (p.errors.length > 0) errors.push(...p.errors)
    else parsed.set(name, p.patch)
  }

  const s = clone(DEFAULTS)
  const policy = parsed.get('policy')
  const locks = expandLocks(policy?.locked ?? [])
  const apply = (name: SourceName, patch: Patch, strictOnly: boolean): void => {
    const skip = (key: string): boolean => {
      if (locks.has(key) && name !== 'policy') {
        notices.push(`${name}: ${key} is locked by the organization and was left as it is`)
        return true
      }
      return false
    }
    const refuse = (key: string): void => void notices.push(`${name}: ${key} ignored (a project can only make things stricter)`)
    for (const key of Object.keys(patch.enums) as EnumKey[]) {
      const v = patch.enums[key] as string
      if (skip(key)) continue
      if (strictOnly) {
        if (key === 'mode' && v === 'observe') {
          notices.push(`${name}: mode observe ignored (only managed or user settings can turn it on)`)
          continue
        }
        const order = STRICT[key]
        if (!order) {
          refuse(key)
          continue
        }
        if (order.indexOf(v) < order.indexOf(s[key] as string)) {
          refuse(key)
          continue
        }
      }
      ;(s as Record<string, unknown>)[key] = v
    }
    if (patch.off !== undefined && !skip('rules.off')) {
      if (strictOnly) refuse('rules.off')
      else s.rules.off = patch.off
    }
    if (patch.custom !== undefined && !skip('rules.custom')) {
      s.rules.custom = strictOnly ? [...s.rules.custom, ...patch.custom.filter(c => !s.rules.custom.some(x => x.id === c.id))] : patch.custom
    }
    if (patch.actions !== undefined && !skip('rules.actions')) {
      if (!strictOnly) s.rules.actions = patch.actions
      else {
        for (const [id, action] of Object.entries(patch.actions)) {
          const current = s.rules.actions[id] ?? 'hide'
          if (ACTION_STRICT.indexOf(action) >= ACTION_STRICT.indexOf(current)) s.rules.actions[id] = action
          else refuse('rules.actions')
        }
      }
    }
    if (patch.allow !== undefined && !skip('allow')) {
      if (strictOnly) refuse('allow')
      else s.allow = patch.allow
    }
    if (patch.secret_files !== undefined && !skip('secret_files')) {
      s.secret_files = strictOnly ? [...new Set([...s.secret_files, ...patch.secret_files])] : patch.secret_files
    }
    if (patch.days !== undefined && !skip('log.days')) {
      if (strictOnly) refuse('log.days')
      else s.log.days = patch.days
    }
  }

  if (policy) {
    apply('policy', policy, false)
    s.locked = policy.locked ?? []
  }
  const user = parsed.get('user')
  if (user) apply('user', user, false)
  for (const name of ['project', 'local', 'flag'] as const) {
    const p = parsed.get(name)
    if (p) apply(name, p, true)
  }

  const ok = errors.length === 0
  // Only a broken managed or user source falls back. A broken project source is left out on its
  // own: a downloaded repo must not be able to freeze the settings at an older state.
  const trustedBroken = errors.some(e => e.startsWith('policy:') || e.startsWith('user:'))
  if (trustedBroken && o.lastGood) return { settings: o.lastGood, errors, notices: [...notices, ...notYet(o.lastGood)], ok }
  return { settings: s, errors, notices: [...notices, ...notYet(s)], ok }
}

/** What the checker is built from. Bad custom rules are refused by createChecker, with a reason (R-15). */
export function checkerOptions(s: Settings): CheckerOptions {
  return { off: s.rules.off, actions: s.rules.actions, custom: s.rules.custom }
}

/** Turns `allow` entries into the Redactor's form. Patterns match the whole value. */
export function compileAllow(entries: readonly AllowEntry[]): { allow: Allow; errors: string[] } {
  const values = new Set<string>()
  const patterns: RegExp[] = []
  const errors: string[] = []
  entries.forEach((entry, i) => {
    if (typeof entry === 'string') {
      values.add(entry)
      return
    }
    const compiled = convertAllowPattern(entry.pattern)
    if ('reason' in compiled) {
      errors.push(`allow entry ${i + 1}: pattern refused: ${compiled.reason}`)
      return
    }
    try {
      patterns.push(new RegExp(`^(?:${compiled.source})$`, compiled.flags))
    } catch {
      errors.push(`allow entry ${i + 1}: pattern refused: the regex engine refused it`)
    }
  })
  return { allow: { values, patterns }, errors }
}
