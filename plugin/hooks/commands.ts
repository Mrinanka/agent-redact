// `/redact` and its subcommands (spec §15). Only the person can run them (R-16): the engine refuses a
// registered command through the Skill tool, and a run from a plugin is refused here. A value never
// comes in on the command line: `add` and `learn` take theirs in a pane, where no row is made.

import type { EngineInterface } from 'claude-code'
import { addToList, osOf, storeReport } from './backends.ts'
import { createChecker } from './lib/checker/index.ts'
import { now } from './lib/core/decoder.ts'
import { parseEnv, startsTicked } from './lib/core/envfile.ts'
import { reportText, runSelfCheck } from './lib/core/selfcheck.ts'
import { isTested } from './lib/core/versions.ts'
import { PLUGIN_VERSION } from './marker.ts'
import { writeLog } from './log-file.ts'
import { dataDir, joinPath } from './paths.ts'
import { liftResume } from './resume.ts'
import { ready, registeredChanged } from './runtime.ts'
import { addAllowedTag, hiddenSummary, placedFiles, setGuardPass } from './state.ts'
import { clearGuardBlock, lastGuardBlock } from './tools.ts'
import { learnValues } from './panes.tsx'

export const COMMAND = 'redact'
export const DOCTOR = 'secret-shield:doctor'
export const ADD_PANE = 'secret-shield-add'
export const LEARN_PANE = 'secret-shield-learn'

const USAGE = 'Use: /redact, /redact add [--label name], /redact learn, /redact allow [tag] [--always], /redact self-check [--report], /redact doctor.'
const MAX_DEPTH = 3
const MAX_FILE = 1024 * 1024
const SKIP = new Set(['.git', 'node_modules'])

/** The value a mistaken `/redact add <value>` left on its command row, to be masked there. */
let maskNext: string | undefined

export function takeMask(): string | undefined {
  const m = maskNext
  maskNext = undefined
  return m
}

export const isPerson = (kind: string | undefined): boolean => kind === 'composer' || kind === 'sdk' || kind === 'bridge'

async function status($: EngineInterface): Promise<string> {
  const rt = await ready($)
  const hidden = await hiddenSummary($)
  const placed = await placedFiles($)
  const lines = [
    `secret-shield ${PLUGIN_VERSION}: main lock running; backup lock not available yet.`,
    `Mode: ${rt.settings.mode === 'observe' ? 'OBSERVE, secrets are NOT being hidden' : 'enforce'}.`,
    `Hidden this session: ${hidden.length}.`,
    ...hidden.slice(-20).map(h => `  ${h.label}${h.hint ? ` ...${h.hint}` : ''} in ${h.where} #${h.tag}`),
  ]
  if (placed.length > 0) lines.push('Files that got a placeholder:', ...placed.slice(-20).map(p => `  ${p.file}, line ${p.line}`))
  return lines.join('\n')
}

async function add($: EngineInterface, rest: string): Promise<string> {
  const m = /^(?:--label\s+([A-Za-z0-9_-]{1,40}))?$/.exec(rest.trim())
  if (!m) {
    maskNext = rest
    return 'Nothing was saved. Never put a secret on the command line: Claude Code keeps that line in its transcript, so consider rotating that value. Run /redact add alone, and paste the secret into the box.'
  }
  if ((await $.session.surfaces()).length === 0) return '/redact add needs an interactive session, because the secret goes into a box on screen.'
  await $.state.set({ plugin: 'secret-shield', key: 'addNote' }, m[1] ? { text: `Label: ${m[1]}`, isError: false } : null)
  await $.ui.open({ id: ADD_PANE, title: 'Add a secret', focus: true, closeOnEscape: true, rows: 7 })
  return 'Paste the secret into the box. It stays out of the chat.'
}

async function envFiles($: EngineInterface, dir: string, patterns: readonly string[], depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= 100) return
  const matches = (name: string): boolean => patterns.some(p => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(name))
  for (const e of await $.fs.list(dir)) {
    if (e.kind === 'file' && matches(e.name) && e.size <= MAX_FILE) out.push(joinPath(dir, e.name))
    else if (e.kind === 'dir' && !SKIP.has(e.name)) await envFiles($, joinPath(dir, e.name), patterns, depth + 1, out)
  }
}

async function learn($: EngineInterface): Promise<string> {
  if ((await $.session.surfaces()).length === 0) return '/redact learn needs an interactive session.'
  const rt = await ready($)
  const cwd = await $.session.cwd()
  const files: string[] = []
  await envFiles($, cwd, rt.settings.secret_files, 0, files)
  const checker = createChecker({}).checker
  const rows = []
  learnValues.clear()
  for (const file of files) {
    for (const entry of parseEnv(String(await $.fs.read(file)))) {
      const id = `v${learnValues.size}`
      learnValues.set(id, entry.value)
      rows.push({ id, file: file.slice(cwd.length + 1), key: entry.key, length: entry.value.length, ticked: startsTicked(checker, entry.key, entry.value) })
    }
  }
  if (rows.length === 0) return 'No values found in files matching secret_files.'
  await $.state.set({ plugin: 'secret-shield', key: 'learnRows' }, rows)
  await $.state.set({ plugin: 'secret-shield', key: 'learnNote' }, null)
  await $.ui.open({ id: LEARN_PANE, title: 'Learn secrets', focus: true, closeOnEscape: true })
  return `Found ${rows.length} values. Tick the ones to remember.`
}

async function allow($: EngineInterface, rest: string): Promise<string> {
  const words = rest.split(/\s+/).filter(Boolean)
  const always = words.includes('--always')
  const tag = words.find(w => w !== '--always')
  if (tag === undefined) {
    if (await liftResume($)) return 'Continuing: the secrets in this history will reach the model. Your next message goes through.'
    const file = lastGuardBlock()
    if (file !== undefined) {
      await setGuardPass($, { file })
      clearGuardBlock()
      return 'The last blocked change can go through once.'
    }
    return 'Nothing is waiting to be allowed. To mark a hidden value as harmless: /redact allow <tag>.'
  }
  const rt = await ready($)
  const value = rt.redactor.valueOfTag(tag)
  if (value === undefined || !rt.redactor.allowTag(tag)) return `There is no hidden value with that tag in this session.`
  await addAllowedTag($, tag)
  await writeLog($, [{ t: await $.clock.now(), event: 'notice', door: 'command', where: 'allow', tag, detail: always ? 'marked harmless for good' : 'marked harmless for this session' }], t => t)
  if (always) {
    try {
      await addToList($, [{ value, label: 'harmless', added: new Date(await $.clock.now()).toISOString().slice(0, 10), harmless: true }])
      registeredChanged()
    } catch {
      return 'Marked harmless for this session, but it could not be saved for later: the password store did not take it.'
    }
    return 'Marked harmless, now and in later sessions.'
  }
  return 'Marked harmless for this session.'
}

async function selfCheck($: EngineInterface, rest: string): Promise<string> {
  const results = runSelfCheck(() => createChecker({}).checker)
  const passed = results.filter(r => r.pass).length
  const summary = [`self-check: ${passed} of ${results.length} passed.`, ...results.filter(r => !r.pass).map(r => `FAIL ${r.name}`)].join('\n')
  if (!rest.includes('--report')) return summary
  const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const path = joinPath(await dataDir($), 'reports', `self-check-${date}.txt`)
  await $.fs.write(path, reportText(results, { version: PLUGIN_VERSION, engine: (await $.session.version()).version, os: await osOf($), date }))
  return `${summary}\nReport (no secrets): ${path}`
}

export async function doctor($: EngineInterface): Promise<string> {
  const rt = await ready($)
  const version = (await $.session.version()).version
  const policy = (await $.settings.read({ source: 'policy' }).catch(() => ({}))) as Record<string, unknown>
  const user = JSON.stringify(await $.settings.read({ source: 'user' }).catch(() => ({})))
  const store = await storeReport($).catch(() => undefined)
  const session = await $.session.id()
  const marker = await $.fs.exists(joinPath(await dataDir($), 'markers', `${session}.json`)).catch(() => false)
  const fix: string[] = []
  if (!isTested(version)) fix.push('Run /redact self-check on this Claude Code version.')
  if (store?.status === 'missing') fix.push('Install a password store (Linux: libsecret-tools and a keyring) to keep saved secrets.')
  if (store?.status === 'locked') fix.push('Unlock your password store; saved secrets are not being hidden until then.')
  if (rt.problems.length > 0) fix.push('Fix the settings problems below.')
  return [
    `Claude Code: ${version} (${isTested(version) ? 'tested' : 'not on the tested list'}).`,
    `Install: ${'secretShield' in policy || 'enabledPlugins' in policy ? 'Managed settings are present' : 'Personal mode'}.`,
    'Plugin tier: not visible to the plugin; in Personal mode it is user.',
    'Main lock hooks: running (this answer came from a hook).',
    `Password store: ${store ? `${store.status}, ${store.count} saved` : 'could not be checked'}.`,
    `Backup lock: ${user.includes('secret-shield') && user.includes('hooks') ? 'hooks found in user settings' : 'not installed'}.`,
    `Marker: ${marker ? 'present' : 'missing'}.`,
    `Settings: ${rt.problems.length === 0 ? 'valid' : rt.problems.join('; ')}.`,
    ...(fix.length > 0 ? ['To fix:', ...fix.map(f => `  ${f}`)] : []),
  ].join('\n')
}

export async function redactCommand($: EngineInterface, args: string): Promise<string> {
  const trimmed = args.trim()
  const space = trimmed.search(/\s/)
  const sub = space < 0 ? trimmed : trimmed.slice(0, space)
  const rest = space < 0 ? '' : trimmed.slice(space + 1)
  switch (sub) {
    case '': return status($)
    case 'add': return add($, rest)
    case 'learn': return learn($)
    case 'allow': return allow($, rest)
    case 'self-check': return selfCheck($, rest)
    case 'doctor': return doctor($)
    default: return `Unknown subcommand. ${USAGE}`
  }
}

/** Claude can't reach these through a tool either (R-16). */
export function isOwnCommandCall(tool: string, input: Record<string, unknown>): boolean {
  return tool === 'Skill' && typeof input.skill === 'string' && /^(?:secret-shield:)?(?:redact|doctor)\b/.test(input.skill)
}

export { now }
