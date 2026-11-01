// The OS password store, reached through `$` (spec §8.1, R-10). The logic is in lib/core/store.ts and
// lib/core/backends.ts; this file only answers their `exec` and `files` with `$`.

import type { EngineInterface } from 'claude-code'
import { backendFor, type Exec, type Files, type StoreOS } from './lib/core/backends.ts'
import { loadList, saveList, type Backend, type SecretEntry, type StoreStatus } from './lib/core/store.ts'
import { dataDir, joinPath } from './paths.ts'
import { writeLog } from './log-file.ts'
import { warn } from './warn.ts'

export async function osOf($: EngineInterface): Promise<StoreOS> {
  // A drive letter says Windows even where a host passes a short environment.
  if ((await $.env.get('OS')) === 'Windows_NT' || /^[A-Za-z]:[\\/]/.test(await $.session.cwd())) return 'windows'
  try {
    const r = await $.process.run(['uname', '-s'], { timeoutMs: 5000 })
    return r.stdout.trim() === 'Darwin' ? 'macos' : 'linux'
  } catch {
    return 'linux'
  }
}

async function backend($: EngineInterface): Promise<Backend> {
  const exec: Exec = (argv, init) => $.process.run(argv, init)
  const dir = await dataDir($)
  const files: Files = {
    read: async path => String(await $.fs.read(path)),
    write: (path, text) => $.fs.write(path, text),
    exists: path => $.fs.exists(path),
    path: name => joinPath(dir, 'store', `${name}.dpapi`),
  }
  return backendFor(await osOf($), { exec, files })
}

export type StoreLoad = { entries: SecretEntry[]; failed: boolean }

/** `failed` means a list exists that could not be read, so the caller tries again later. */
export async function loadRegisteredSecrets($: EngineInterface): Promise<StoreLoad> {
  try {
    const loaded = await loadList(await backend($))
    if (loaded.warning) {
      warn($, 'store', loaded.warning)
      await writeLog($, [{ t: await $.clock.now(), event: 'failure', door: 'store', detail: loaded.warning }], t => t)
    }
    return { entries: loaded.entries, failed: loaded.warning !== undefined && loaded.unavailable !== undefined }
  } catch {
    warn($, 'store', 'the saved secrets could not be loaded; other checks carry on')
    await writeLog($, [{ t: Date.now(), event: 'failure', door: 'store', detail: 'load failed' }], t => t)
    return { entries: [], failed: true }
  }
}

/** Adds to the saved list. Refused while the list can't be read, because a save would replace it. */
export async function addToList($: EngineInterface, added: readonly SecretEntry[]): Promise<number> {
  const b = await backend($)
  const loaded = await loadList(b)
  if (loaded.warning) throw new Error(loaded.warning)
  if (loaded.unavailable) throw new Error(`the password store is ${loaded.unavailable}, so nothing can be saved`)
  const known = new Set(loaded.entries.map(e => e.value))
  const fresh = added.filter(e => !known.has(e.value))
  if (fresh.length > 0) await saveList(b, [...loaded.entries, ...fresh])
  return fresh.length
}

export async function storeReport($: EngineInterface): Promise<{ status: StoreStatus; count: number; warning?: string }> {
  const b = await backend($)
  const status = await b.status().catch((): StoreStatus => 'missing')
  const loaded = await loadList(b)
  return { status: loaded.unavailable ?? status, count: loaded.entries.length, ...(loaded.warning ? { warning: loaded.warning } : {}) }
}
