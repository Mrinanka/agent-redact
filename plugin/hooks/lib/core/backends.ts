// The three OS password stores (spec §8.1, R-10, D-023, D-036). Values go through stdin only, never on
// a command line, where another process could read them. The text handed in is always ASCII (base64),
// so no quoting rule of any shell or program can change it. `exec` and `files` are passed in: the mod
// answers them with `$`, and tests and `tools/measure/store.ts` answer them with Node.
//
// An error message from a program is never kept: it could echo what it was given.

import type { Backend, StoreStatus } from './store.ts'

export type ExecResult = { exitCode: number; stdout: string; stderr: string }
export type Exec = (argv: readonly string[], init?: { stdin?: string; timeoutMs?: number }) => Promise<ExecResult>

/** Windows keeps DPAPI's output in files. Only ciphertext reaches them. */
export type Files = {
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** Where an item's file lives. */
  path(name: string): string
}

export type StoreOS = 'macos' | 'linux' | 'windows'
export type Tools = { exec: Exec; files: Files; service?: string }

export const SERVICE = 'secret-shield'
const TIMEOUT_MS = 20_000
const INDEX = 'index'

/**
 * How much one item holds, and how many items a list may use. Set from `npm run measure:store`
 * (D-045): well under each store's limit, and few enough that reading them at session start stays quick.
 */
export const LIMITS: Record<StoreOS, { pieceBytes: number; maxPieces: number }> = {
  macos: { pieceBytes: 1024, maxPieces: 64 },
  linux: { pieceBytes: 1024, maxPieces: 64 },
  windows: { pieceBytes: 1024 * 1024, maxPieces: 4 },
}

const POWERSHELL = ['powershell', '-NoProfile', '-NonInteractive', '-Command']
const SETUP = '$in = [Console]::In.ReadToEnd().Trim(); Add-Type -AssemblyName System.Security'
const PROTECT = `${SETUP}; $b = [Text.Encoding]::ASCII.GetBytes($in); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))`
const UNPROTECT = `${SETUP}; $b = [Convert]::FromBase64String($in); [Text.Encoding]::ASCII.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))`

async function statusFrom(run: () => Promise<ExecResult>, ok: (r: ExecResult) => boolean): Promise<StoreStatus> {
  try {
    return ok(await run()) ? 'ok' : 'locked'
  } catch {
    return 'missing'
  }
}

function macos({ exec, service }: Tools & { service: string }): Backend {
  const id = (name: string): string[] => ['-a', name, '-s', service]
  const backend: Backend = {
    id: 'keychain',
    ...LIMITS.macos,
    status: () => statusFrom(() => exec(['security', 'default-keychain'], { timeoutMs: TIMEOUT_MS }), r => r.exitCode === 0),
    hasList: async () => (await backend.get(INDEX)) !== undefined,
    put: async (name, text) => {
      // `security -i` reads the command from stdin, so the value is on no command line (D-036).
      const r = await exec(['security', '-i'], { stdin: `add-generic-password -a ${name} -s ${service} -U -w "${text}"\n`, timeoutMs: TIMEOUT_MS })
      if (r.exitCode !== 0 || r.stderr.trim() !== '') throw new Error('the keychain refused the write')
    },
    get: async name => {
      const r = await exec(['security', 'find-generic-password', ...id(name), '-w'], { timeoutMs: TIMEOUT_MS })
      if (r.exitCode === 44) return undefined
      if (r.exitCode !== 0) throw new Error('the keychain refused the read')
      return r.stdout.trim()
    },
    del: async name => {
      await exec(['security', 'delete-generic-password', ...id(name)], { timeoutMs: TIMEOUT_MS })
    },
  }
  return backend
}

function linux({ exec, service }: Tools & { service: string }): Backend {
  const id = (name: string): string[] => ['service', service, 'account', name]
  const backend: Backend = {
    id: 'secret-service',
    ...LIMITS.linux,
    status: () => statusFrom(() => exec(['secret-tool', 'lookup', ...id(INDEX)], { timeoutMs: TIMEOUT_MS }), r => r.exitCode === 0 || r.stderr.trim() === ''),
    hasList: async () => (await backend.get(INDEX)) !== undefined,
    put: async (name, text) => {
      const r = await exec(['secret-tool', 'store', `--label=${service}`, ...id(name)], { stdin: text, timeoutMs: TIMEOUT_MS })
      if (r.exitCode !== 0) throw new Error('the Secret Service refused the write')
    },
    get: async name => {
      const r = await exec(['secret-tool', 'lookup', ...id(name)], { timeoutMs: TIMEOUT_MS })
      if (r.exitCode === 0) return r.stdout.trim()
      // No item: exit 1 and nothing said. Anything said means the service itself failed.
      if (r.stderr.trim() === '') return undefined
      throw new Error('the Secret Service refused the read')
    },
    del: async name => {
      await exec(['secret-tool', 'clear', ...id(name)], { timeoutMs: TIMEOUT_MS })
    },
  }
  return backend
}

function windows({ exec, files }: Tools): Backend {
  const dpapi = async (script: string, input: string): Promise<string> => {
    const r = await exec([...POWERSHELL, script], { stdin: input, timeoutMs: TIMEOUT_MS })
    const out = r.stdout.trim()
    if (r.exitCode !== 0 || out === '') throw new Error('DPAPI refused the call')
    return out
  }
  const held = async (name: string): Promise<string | undefined> => {
    const path = files.path(name)
    if (!(await files.exists(path))) return undefined
    const text = (await files.read(path)).trim()
    return text === '' ? undefined : text
  }
  return {
    id: 'dpapi',
    ...LIMITS.windows,
    status: () => statusFrom(() => exec([...POWERSHELL, 'exit 0'], { timeoutMs: TIMEOUT_MS }), r => r.exitCode === 0),
    hasList: async () => (await held(INDEX)) !== undefined,
    put: async (name, text) => {
      await files.write(files.path(name), await dpapi(PROTECT, text))
    },
    get: async name => {
      const blob = await held(name)
      return blob === undefined ? undefined : dpapi(UNPROTECT, blob)
    },
    // A mod can't delete a file, so a removed item is an empty one.
    del: async name => {
      if ((await held(name)) !== undefined) await files.write(files.path(name), '')
    },
  }
}

export function backendFor(os: StoreOS, tools: Tools): Backend {
  const all = { ...tools, service: tools.service ?? SERVICE }
  switch (os) {
    case 'macos': return macos(all)
    case 'linux': return linux(all)
    case 'windows': return windows(all)
  }
}
