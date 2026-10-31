// npm run measure:store: what one item of the OS password store holds, and how long reading many takes
// (D-036), so the piece size and list cap come from numbers. The data is random, cleaned up after, and
// printed as sizes and times only. Prints `unavailable` and exits 0 when this machine has no store:
// a CI step reading the output is how the numbers get recorded.

import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backendFor, type Exec, type Files, type StoreOS } from '../../src/core/backends.ts'
import type { Backend } from '../../src/core/store.ts'

export const nodeExec: Exec = async (argv, init) => {
  const [cmd, ...args] = argv as [string, ...string[]]
  const r = spawnSync(cmd, args, { input: init?.stdin ?? '', encoding: 'utf8', timeout: init?.timeoutMs ?? 20_000, maxBuffer: 8 * 1024 * 1024 })
  if (r.error) throw r.error
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export function nodeFiles(dir: string): Files {
  return {
    read: async p => fs.readFileSync(p, 'utf8'),
    write: async (p, t) => {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, t)
    },
    exists: async p => fs.existsSync(p),
    path: name => path.join(dir, `${name}.dpapi`),
  }
}

export const thisOS = (): StoreOS => (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux')

const ascii = (size: number): string => randomBytes(Math.ceil(size)).toString('base64').replace(/[+/=]/g, 'A').slice(0, size)

async function fits(b: Backend, size: number): Promise<boolean> {
  const text = ascii(size)
  try {
    await b.put('measure', text)
    return (await b.get('measure')) === text
  } catch {
    return false
  } finally {
    await b.del('measure').catch(() => undefined)
  }
}

/** The largest size that round-trips, to within 256 bytes, up to `top`. */
async function limitOf(b: Backend, top: number): Promise<{ largestOk: number; firstFail?: number }> {
  let ok = 0
  let bad: number | undefined
  for (let size = 1024; size <= top; size *= 2) {
    if (await fits(b, size)) ok = size
    else {
      bad = size
      break
    }
  }
  if (bad === undefined) return { largestOk: ok }
  while (bad - ok > 256) {
    const mid = Math.floor((ok + bad) / 2)
    if (await fits(b, mid)) ok = mid
    else bad = mid
  }
  return { largestOk: ok, firstFail: bad }
}

async function readTimes(b: Backend, size: number): Promise<void> {
  for (const count of [1, 10, 50, 100]) {
    const names = Array.from({ length: count }, (_, i) => `measure-${i}`)
    try {
      for (const n of names) await b.put(n, ascii(size))
      const t0 = performance.now()
      for (const n of names) await b.get(n)
      const ms = performance.now() - t0
      console.log(`read ${String(count).padStart(3)} items of ${size} bytes: ${ms.toFixed(0)} ms (${(ms / count).toFixed(1)} per item)`)
    } catch {
      console.log(`read ${count} items of ${size} bytes: failed`)
    } finally {
      for (const n of names) await b.del(n).catch(() => undefined)
    }
  }
}

/** Whether `security -i` keeps what it was given in a history file. Top-level dot files only. */
async function historyCheck(): Promise<void> {
  const marker = `secretshieldmarker${randomUUID().replace(/-/g, '')}`
  const home = os.homedir()
  const started = Date.now() - 2000
  await nodeExec(['security', '-i'], { stdin: `add-generic-password -a measure-history -s ${marker} -U -w "${marker}"\n` })
  await nodeExec(['security', 'delete-generic-password', '-a', 'measure-history', '-s', marker])
  let changed = 0
  let found = 0
  for (const e of fs.readdirSync(home, { withFileTypes: true })) {
    if (!e.isFile()) continue
    const file = path.join(home, e.name)
    const stat = fs.statSync(file)
    if (stat.mtimeMs < started || stat.size > 4 * 1024 * 1024) continue
    changed++
    if (fs.readFileSync(file, 'utf8').includes(marker)) found++
  }
  console.log(`security -i history check: ${changed} home files changed, ${found} hold the value`)
}

async function main(): Promise<void> {
  const name = thisOS()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-store-'))
  const b = backendFor(name, { exec: nodeExec, files: nodeFiles(dir), service: `secret-shield-measure-${randomUUID()}` })
  try {
    const status = await b.status()
    console.log(`store ${b.id} on ${name}: ${status}`)
    if (status !== 'ok' || !(await fits(b, 64))) {
      console.log('unavailable: nothing measured')
      return
    }
    const limit = await limitOf(b, name === 'windows' ? 2 * 1024 * 1024 : 256 * 1024)
    console.log(`largest item that round-trips: ${limit.largestOk} bytes${limit.firstFail === undefined ? ' (the top of the range tried)' : `; fails at ${limit.firstFail}`}`)
    await readTimes(b, name === 'windows' ? 1024 : Math.min(1024, limit.largestOk))
    if (name === 'macos') await historyCheck()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
