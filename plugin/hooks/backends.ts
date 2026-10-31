// The OS password store, reached through `$` (spec §8.1, R-10). The logic is in lib/core/store.ts and
// lib/core/backends.ts; this file only answers their `exec` and `files` with `$`.

import type { EngineInterface } from 'claude-code'
import { backendFor, type Exec, type Files, type StoreOS } from './lib/core/backends.ts'
import { loadList, type SecretEntry } from './lib/core/store.ts'
import { dataDir, joinPath } from './paths.ts'
import { warn } from './warn.ts'

async function osOf($: EngineInterface): Promise<StoreOS> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  try {
    const r = await $.process.run(['uname', '-s'], { timeoutMs: 5000 })
    return r.stdout.trim() === 'Darwin' ? 'macos' : 'linux'
  } catch {
    return 'linux'
  }
}

export async function loadRegisteredSecrets($: EngineInterface): Promise<SecretEntry[]> {
  try {
    const exec: Exec = (argv, init) => $.process.run(argv, init)
    const dir = await dataDir($)
    const files: Files = {
      read: async path => String(await $.fs.read(path)),
      write: (path, text) => $.fs.write(path, text),
      exists: path => $.fs.exists(path),
      path: name => joinPath(dir, 'store', `${name}.dpapi`),
    }
    const loaded = await loadList(backendFor(await osOf($), { exec, files }))
    if (loaded.warning) warn($, 'store', loaded.warning)
    return loaded.entries
  } catch {
    warn($, 'store', 'the saved secrets could not be loaded; other checks carry on')
    return []
  }
}
