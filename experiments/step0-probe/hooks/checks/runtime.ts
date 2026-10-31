// Checks 0.4 and 0.13, with on-runtime, once at session.start:
// - 0.4: WebCrypto (AES-256-GCM round trip, secure random) inside the mod, and
//   whether $.process.run reaches the OS password stores: a DPAPI round trip
//   through Windows PowerShell, macOS `security`, Linux `secret-tool`.
// - 0.13: whether `node` runs from $.process.run, and its version.
// Only booleans and labels are logged. The round-trip values are random bytes,
// passed on stdin and never logged.

import type { EngineInterface } from 'claude-code'
import { checkLine, isOn, label } from './common.ts'
import { append } from '../log.ts'

export const DPAPI = [
  '$in = [Console]::In.ReadToEnd().Trim()',
  'Add-Type -AssemblyName System.Security',
  '$b = [Convert]::FromBase64String($in)',
  "$p = [System.Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser')",
  "$u = [System.Security.Cryptography.ProtectedData]::Unprotect($p, $null, 'CurrentUser')",
  "if ([Convert]::ToBase64String($u) -eq $in -and [Convert]::ToBase64String($p) -ne $in) { 'roundtrip-ok' } else { 'roundtrip-bad' }",
].join('; ')

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s)
}

// The types declare crypto.subtle with digest only (claude-code.d.ts:16030).
// This probe asks the runtime for the AES-GCM members anyway, so it reads them
// through a wider type of its own.
type AesKey = unknown
type MaybeAesSubtle = {
  generateKey?: (alg: { name: string; length: number }, extractable: boolean, uses: string[]) => Promise<AesKey>
  encrypt?: (alg: { name: string; iv: Uint8Array }, key: AesKey, data: Uint8Array) => Promise<ArrayBuffer>
  decrypt?: (alg: { name: string; iv: Uint8Array }, key: AesKey, data: Uint8Array) => Promise<ArrayBuffer>
}

async function aesGcm(): Promise<{ subtle: boolean; aesGcm: boolean; random: boolean }> {
  const s = (typeof crypto === 'object' ? crypto.subtle : undefined) as MaybeAesSubtle | undefined
  const subtle = typeof s?.generateKey === 'function' && typeof s.encrypt === 'function' && typeof s.decrypt === 'function'
  let random = false
  let ok = false
  try {
    const a = crypto.getRandomValues(new Uint8Array(32))
    const b = crypto.getRandomValues(new Uint8Array(32))
    random = a.some((x, i) => x !== b[i])
    if (subtle && s?.generateKey && s.encrypt && s.decrypt) {
      const key = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const sealed = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv }, key, a))
      const opened = new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv }, key, sealed))
      ok = opened.length === a.length && opened.every((x, i) => x === a[i]) && sealed.length === a.length + 16
    }
  } catch {
    ok = false
  }
  return { subtle, aesGcm: ok, random }
}

// 'missing' when the command can't start; otherwise the first line of its
// output as a label, or 'found' when asked only whether it runs.
async function tryRun($: EngineInterface, argv: string[], opts: { stdin?: string; output: boolean }): Promise<string> {
  try {
    const r = await $.process.run(argv, { stdin: opts.stdin, timeoutMs: 20_000 })
    if (!opts.output) return 'found'
    return label(r.stdout.split(/\r?\n/)[0] ?? '')
  } catch {
    return 'missing'
  }
}

/** Called from the probe's session.start hook, after next. */
export async function runtimeAtStart($: EngineInterface): Promise<void> {
  if (!(await isOn($, 'runtime'))) return
  const t0 = await $.clock.now()
  const crypto0 = await aesGcm()
  const t1 = await $.clock.now()
  const secret = b64(crypto.getRandomValues(new Uint8Array(32)))
  const dpapi = await tryRun($, ['powershell', '-NoProfile', '-NonInteractive', '-Command', DPAPI], { stdin: secret, output: true })
  const t2 = await $.clock.now()
  const security = await tryRun($, ['security', 'list-keychains'], { output: false })
  const secretTool = await tryRun($, ['secret-tool', '--version'], { output: false })
  await append($, await checkLine($, '0.4', { ...crypto0, cryptoMs: t1 - t0, dpapi, dpapiMs: t2 - t1, security, secretTool }))
  const node = await tryRun($, ['node', '--version'], { output: true })
  await append($, await checkLine($, '0.13', { node }))
}
