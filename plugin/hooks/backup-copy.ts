// The backup lock's stable copy (spec §5.2, §15, D-068). An installed plugin's folder can move or be replaced
// by an update, and the settings hooks point at a fixed path, so `/redact backup` copies `plugin/backup/` to
// <config>/secret-shield/backup/ and the settings point there. Later sessions refresh an existing copy when
// its manifest differs from the plugin's, and never create one unasked.
//
// Only text moves here: compiled JavaScript, JSON and the licences. A mod can't delete a file, so a file the
// new version no longer has stays behind, unused.

import type { EngineInterface } from 'claude-code'
import { backupSnippet } from './lib/core/snippet.ts'
import { dataDir, joinPath } from './paths.ts'

const MANIFEST = 'manifest.json'

export type BackupState = {
  /** The plugin carries a build of the backup lock. */
  hasSource: boolean
  installed: boolean
  /** The copy's manifest equals the plugin's. */
  current: boolean
  copyVersion?: string
  pluginVersion?: string
}

export async function stableDir($: EngineInterface): Promise<string> {
  return joinPath(await dataDir($), 'backup')
}

export async function stableMain($: EngineInterface): Promise<string> {
  return joinPath(await stableDir($), 'backup', 'main.js')
}

function sourceDir($: EngineInterface): string {
  return joinPath($.plugin.root, 'backup')
}

async function readIfThere($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : undefined
  } catch {
    return undefined
  }
}

const versionOf = (manifest: string | undefined): string | undefined => {
  try {
    const v = (JSON.parse(manifest ?? '') as { version?: unknown }).version
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

export async function backupState($: EngineInterface): Promise<BackupState> {
  const source = await readIfThere($, joinPath(sourceDir($), MANIFEST))
  const copy = await readIfThere($, joinPath(await stableDir($), MANIFEST))
  const state: BackupState = { hasSource: source !== undefined, installed: copy !== undefined, current: source !== undefined && source === copy }
  const copyVersion = versionOf(copy)
  const pluginVersion = versionOf(source)
  if (copyVersion !== undefined) state.copyVersion = copyVersion
  if (pluginVersion !== undefined) state.pluginVersion = pluginVersion
  return state
}

/** Every file below `root`, as forward-slash names. */
async function filesUnder($: EngineInterface, root: string, rel: string[] = []): Promise<string[]> {
  const out: string[] = []
  for (const e of await $.fs.list(joinPath(root, ...rel))) {
    if (e.kind === 'dir') out.push(...(await filesUnder($, root, [...rel, e.name])))
    else if (e.kind === 'file') out.push([...rel, e.name].join('/'))
  }
  return out
}

/** Copies the plugin's build to the stable folder. The manifest goes last, so a copy cut short reads as not current. */
export async function installBackup($: EngineInterface): Promise<{ files: number; main: string }> {
  const from = sourceDir($)
  const to = await stableDir($)
  const manifest = await readIfThere($, joinPath(from, MANIFEST))
  if (manifest === undefined) throw new Error('this plugin has no backup lock build')
  const names = (await filesUnder($, from)).filter(n => n !== MANIFEST).sort()
  for (const name of names) {
    const parts = name.split('/')
    await $.fs.write(joinPath(to, ...parts), String(await $.fs.read(joinPath(from, ...parts))))
  }
  await $.fs.write(joinPath(to, MANIFEST), manifest)
  return { files: names.length + 1, main: await stableMain($) }
}

/** At session start: an existing copy that is out of date is made current. Never creates one. */
export async function refreshBackup($: EngineInterface): Promise<'absent' | 'current' | 'refreshed' | 'failed'> {
  try {
    const s = await backupState($)
    if (!s.installed || !s.hasSource) return 'absent'
    if (s.current) return 'current'
    await installBackup($)
    return 'refreshed'
  } catch {
    return 'failed'
  }
}

export type HookFacts = { found: boolean; blocksOnFailure: boolean }

/** Whether a settings object's `hooks` run the backup lock, and whether every one of them sets `onFailure: "block"`. */
export function backupHooksIn(settings: unknown): HookFacts {
  const hooks = (settings as { hooks?: unknown } | null)?.hooks
  let found = false
  let all = true
  if (typeof hooks === 'object' && hooks !== null) {
    for (const groups of Object.values(hooks)) {
      if (!Array.isArray(groups)) continue
      for (const g of groups) {
        const list = (g as { hooks?: unknown } | null)?.hooks
        if (!Array.isArray(list)) continue
        for (const h of list) {
          const o = h as { args?: unknown; command?: unknown; onFailure?: unknown } | null
          const parts = [...(Array.isArray(o?.args) ? o.args : []), o?.command].filter((x): x is string => typeof x === 'string')
          if (!parts.some(p => /secret-shield.*[\\/]backup[\\/]main\.js$/i.test(p))) continue
          found = true
          if (o?.onFailure !== 'block') all = false
        }
      }
    }
  }
  return { found, blocksOnFailure: found && all }
}

export async function snippetText($: EngineInterface, managed: boolean): Promise<string> {
  return JSON.stringify(backupSnippet({ main: await stableMain($), managed }), null, 2)
}
