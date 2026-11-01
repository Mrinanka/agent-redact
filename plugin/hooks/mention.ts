// `@` files (spec §5.3): the engine reads a redacted copy instead, so the raw text is never attached or
// stored. The copy keeps the file's name and sits in a random folder of ours; it holds no secret, and is
// emptied at the end of the session because a mod can't delete a file (D-047).

import type { EngineInterface } from 'claude-code'
import { now } from './lib/core/decoder.ts'
import { writeLog } from './log-file.ts'
import { dataDir, joinPath } from './paths.ts'
import { ready } from './runtime.ts'
import { warn } from './warn.ts'

const BUDGET_MS = 4000
const MAX_BYTES = 8 * 1024 * 1024
const MEDIA = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|ico|pdf)$/i

export type MentionAnswer = { path: string; text: string } | { deny: string } | 'as-is'

const copies: string[] = []

function randomName(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')
}

export async function checkMention($: EngineInterface, path: string): Promise<MentionAnswer> {
  const rt = await ready($)
  const observe = rt.settings.mode === 'observe'
  if (MEDIA.test(path)) {
    return rt.settings.media === 'drop' && !observe ? { deny: 'secret-shield: the media setting is drop, so this file was not attached.' } : 'as-is'
  }
  const stat = await $.fs.stat(path)
  if (stat.kind !== 'file') return 'as-is'
  if (stat.size > MAX_BYTES) throw new Error('too large')
  const text = String(await $.fs.read(path))
  if (text.slice(0, 8192).includes('\u0000')) return 'as-is'
  const res = rt.redactor.redactText(text, { file: path, deadline: now() + BUDGET_MS })
  const secrets = res.hits.filter(h => h.action !== 'warn')
  const clean = (t: string): string => rt.redactor.redactText(t, { deadline: now() + 500 }).text
  if (secrets.length > 0) {
    await writeLog($, secrets.slice(0, 50).map((h, i) => ({ t: i, event: 'hide' as const, door: 'mention', where: path, rule: h.ruleId, label: h.label, tag: h.tag, action: observe ? 'would-hide' : h.action, mode: rt.settings.mode, ...(observe ? { detail: 'would have hidden' } : {}) })).map(l => ({ ...l, t: Date.now() })), clean)
  }
  if (observe) return 'as-is'
  if (res.blocked) return { deny: 'secret-shield: this file holds a secret that your settings say to block, so it was not attached.' }
  if (!res.complete) throw new Error('check ran out of time')
  if (res.text === text) return 'as-is'
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const copy = joinPath(await dataDir($), 'm', randomName(), name)
  await $.fs.write(copy, res.text)
  copies.push(copy)
  // The engine refuses a Windows short name such as RUNNER~1, so it gets the long path.
  const real = (await $.fs.stat(copy, { resolve: true }).catch(() => undefined))?.realPath ?? copy
  return { path: real, text: `Contents of ${name}:\n${res.text}` }
}

/** A failed check follows on_check_failure (R-03, R-12). */
export async function failedMention($: EngineInterface, kind: string, hold: boolean): Promise<string | undefined> {
  warn($, `failure-${kind}`, `a check failed (${kind}) on an @ file. ${hold ? 'It was not attached.' : 'It reached the model unchecked.'}`)
  await writeLog($, [{ t: Date.now(), event: 'failure', door: 'mention', where: 'mention', action: hold ? 'held' : 'allowed', detail: kind }], t => t)
  return hold ? 'secret-shield could not check this file, so it was not attached.' : undefined
}

/** Empties this session's copies, and any an earlier session left. */
export async function emptyCopies($: EngineInterface): Promise<void> {
  try {
    for (const copy of copies.splice(0)) await $.fs.write(copy, '')
    const root = joinPath(await dataDir($), 'm')
    if (!(await $.fs.exists(root))) return
    for (const dir of await $.fs.list(root)) {
      if (dir.kind !== 'dir') continue
      for (const f of await $.fs.list(joinPath(root, dir.name))) if (f.kind === 'file' && f.size > 0) await $.fs.write(joinPath(root, dir.name, f.name), '')
    }
  } catch {
    // Housekeeping: the copies hold no secret.
  }
}
