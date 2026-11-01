// The documented uninstall commands (plan step 6, spec §19), run for real: a saved list goes in through the same
// code the plugin uses, the command from src/core/uninstall.ts removes it, and the store no longer holds it.
// Random data under a service name of its own, so a developer's real saved list is never touched. Skips, saying
// why, on a machine with no working password store (CI's Linux leak-test job runs this inside a keyring).

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backendFor } from '../src/core/backends.ts'
import { loadList, saveList, type SecretEntry } from '../src/core/store.ts'
import { SERVICE, uninstallCommand } from '../src/core/uninstall.ts'
import { nodeExec, nodeFiles, thisOS } from '../tools/measure/store.ts'

const service = `aegiscontext-uninstall-${randomUUID()}`
const config = fs.mkdtempSync(path.join(os.tmpdir(), 'uninstall-real-'))
const dataDir = path.join(config, SERVICE)
fs.mkdirSync(path.join(dataDir, 'store'), { recursive: true })
const b = backendFor(thisOS(), { exec: nodeExec, files: nodeFiles(path.join(dataDir, 'store')), service })
const status = await b.status()
const skip = status === 'ok' ? false : `no working password store here (${b.id}: ${status})`
after(async () => {
  if (status === 'ok') await saveList(b, []).catch(() => undefined)
  fs.rmSync(config, { recursive: true, force: true })
})

const entries = (n: number): SecretEntry[] => Array.from({ length: n }, () => ({ value: randomBytes(24).toString('base64'), label: 'test', added: '2026-11-01' }))

test('the documented uninstall command removes a small saved list from the real store', { skip, timeout: 120_000 }, async () => {
  await saveList(b, entries(3))
  assert.equal((await loadList(b)).entries.length, 3)
  const argv = uninstallCommand(thisOS(), { service, dataDir })
  const r = spawnSync(argv[0] as string, argv.slice(1), { encoding: 'utf8', timeout: 60_000 })
  assert.equal(r.status, 0, `${argv.join(' ')}: ${r.stderr}`)
  assert.deepEqual((await loadList(b)).entries, [], 'the saved values must be gone')
  assert.equal(await b.hasList(), false)
})

test('the documented uninstall command removes a list of several pieces too', { skip, timeout: 120_000 }, async () => {
  if (b.pieceBytes > 64 * 1024) return // Windows takes its list in one piece; the case above covers it.
  await saveList(b, entries(Math.ceil((b.pieceBytes * 2.5) / 100)))
  const argv = uninstallCommand(thisOS(), { service, dataDir })
  const r = spawnSync(argv[0] as string, argv.slice(1), { encoding: 'utf8', timeout: 60_000 })
  assert.equal(r.status, 0, `${argv.join(' ')}: ${r.stderr}`)
  assert.deepEqual((await loadList(b)).entries, [])
})
