// Check 0.4, with on-store, once at session.start: a real round trip through each
// OS password store from $.process.run, at the sizes the list of registered
// secrets could reach (D-023 left those unverified). Each store is cleaned up
// after. Text stored is random test data, never logged: only labels and sizes are.
//
// macOS is tried two ways, because `add-generic-password -w <value>` puts the value
// on a command line, where other processes can read it: `security -i` takes the
// same command on stdin instead.

import type { EngineInterface } from 'claude-code'
import { checkLine, isOn } from './common.ts'
import { DPAPI } from './runtime.ts'
import { append } from '../log.ts'

const SIZES = [1024, 64 * 1024, 1024 * 1024]
const SERVICE = 'step0-probe-store'
const ACCOUNT = 'step0-probe'
const TIMEOUT_MS = 20_000

type Outcome = { exit: number; stdout: string; stderr: string; truncated: boolean }
type Result = 'ok' | 'mismatch' | 'truncated' | 'unavailable' | 'missing'
type Trial = { result: Result; exit?: number; reason?: string }
type Way = 'dpapi/stdin' | 'keychain/argv' | 'keychain/interactive' | 'secret-service/stdin'

function randomText(size: number): string {
  let s = ''
  for (const b of crypto.getRandomValues(new Uint8Array(48))) s += String.fromCharCode(b)
  return btoa(s).repeat(Math.ceil(size / 64)).slice(0, size)
}

async function run($: EngineInterface, argv: string[], stdin?: string): Promise<Outcome | undefined> {
  try {
    const r = await $.process.run(argv, { stdin, timeoutMs: TIMEOUT_MS })
    return { exit: r.exitCode ?? -1, stdout: r.stdout, stderr: r.stderr, truncated: r.isStdoutTruncated }
  } catch {
    return undefined
  }
}

// The tool's own words, without the value, and only if they look like plain words.
function reasonOf(stderr: string, value: string): string {
  const line = (stderr.split(value).join('').split(/\r?\n/)[0] ?? '').trim()
  return /^[A-Za-z0-9 :._,'()-]{1,160}$/.test(line) ? line : '(odd)'
}

function failed(out: Outcome, value: string): Trial {
  return { result: 'unavailable', exit: out.exit, reason: reasonOf(out.stderr, value) }
}

function compared(out: Outcome, value: string): Trial {
  if (out.exit !== 0) return failed(out, value)
  if (out.stdout.trim() === value) return { result: 'ok' }
  return { result: out.truncated ? 'truncated' : 'mismatch' }
}

async function dpapi($: EngineInterface, value: string): Promise<Trial> {
  const out = await run($, ['powershell', '-NoProfile', '-NonInteractive', '-Command', DPAPI], value)
  if (!out) return { result: 'missing' }
  if (out.exit !== 0) return failed(out, value)
  return { result: out.stdout.trim() === 'roundtrip-ok' ? 'ok' : 'mismatch' }
}

const KEYCHAIN_ID = ['-a', ACCOUNT, '-s', SERVICE]

async function keychainRead($: EngineInterface, value: string): Promise<Trial> {
  const read = await run($, ['security', 'find-generic-password', ...KEYCHAIN_ID, '-w'])
  await run($, ['security', 'delete-generic-password', ...KEYCHAIN_ID])
  return read ? compared(read, value) : { result: 'missing' }
}

async function keychainArgv($: EngineInterface, value: string): Promise<Trial> {
  const add = await run($, ['security', 'add-generic-password', ...KEYCHAIN_ID, '-U', '-w', value])
  if (!add) return { result: 'missing' }
  if (add.exit !== 0) return failed(add, value)
  return keychainRead($, value)
}

async function keychainInteractive($: EngineInterface, value: string): Promise<Trial> {
  const add = await run($, ['security', '-i'], `add-generic-password -a ${ACCOUNT} -s ${SERVICE} -U -w "${value}"
`)
  if (!add) return { result: 'missing' }
  if (add.exit !== 0) return failed(add, value)
  return keychainRead($, value)
}

const SECRET_ID = ['service', SERVICE, 'account', ACCOUNT]

async function secretService($: EngineInterface, value: string): Promise<Trial> {
  const add = await run($, ['secret-tool', 'store', `--label=${SERVICE}`, ...SECRET_ID], value)
  if (!add) return { result: 'missing' }
  if (add.exit !== 0) return failed(add, value)
  const read = await run($, ['secret-tool', 'lookup', ...SECRET_ID])
  await run($, ['secret-tool', 'clear', ...SECRET_ID])
  return read ? compared(read, value) : { result: 'missing' }
}

// A switch, not a table of functions: a mod may pass `$` only to functions
// declared or imported at the top of a file (progress, Gotchas).
function roundTrip($: EngineInterface, way: Way, value: string): Promise<Trial> {
  switch (way) {
    case 'dpapi/stdin': return dpapi($, value)
    case 'keychain/argv': return keychainArgv($, value)
    case 'keychain/interactive': return keychainInteractive($, value)
    case 'secret-service/stdin': return secretService($, value)
  }
}

async function tryWay($: EngineInterface, way: Way): Promise<void> {
  const [store = '', method = ''] = way.split('/')
  for (const bytes of SIZES) {
    const t0 = await $.clock.now()
    const trial = await roundTrip($, way, randomText(bytes))
    const ms = (await $.clock.now()) - t0
    await append($, await checkLine($, 'store', { store, method, bytes, ms, ...trial }))
    if (trial.result === 'missing') return
  }
}

/** Called from the probe's session.start hook, after next. */
export async function storeAtStart($: EngineInterface): Promise<void> {
  if (!(await isOn($, 'store'))) return
  await tryWay($, 'dpapi/stdin')
  await tryWay($, 'keychain/argv')
  await tryWay($, 'keychain/interactive')
  await tryWay($, 'secret-service/stdin')
}
