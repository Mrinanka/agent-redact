// The real OS password store, through the same code the plugin uses, with Node standing in for `$`.
// Random data under a service name of its own, cleaned up after. Skips, saying why, on a machine with
// no working store (CI's Linux test job has none; its leak-test job runs this inside a keyring).

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backendFor } from '../src/core/backends.ts'
import { loadList, saveList, type SecretEntry } from '../src/core/store.ts'
import { nodeExec, nodeFiles, thisOS } from '../tools/measure/store.ts'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-real-'))
const b = backendFor(thisOS(), { exec: nodeExec, files: nodeFiles(dir), service: `secret-shield-test-${randomUUID()}` })
const status = await b.status()
let usable = status === 'ok'
if (usable) {
  try {
    await b.put('probe', 'abc')
    usable = (await b.get('probe')) === 'abc'
    await b.del('probe')
  } catch {
    usable = false
  }
}
const skip = usable ? false : `no working password store here (${b.id}: ${status})`

after(async () => {
  if (usable) await saveList(b, []).catch(() => undefined)
  if (usable) await b.del('index').catch(() => undefined)
  fs.rmSync(dir, { recursive: true, force: true })
})

const entry = (value: string): SecretEntry => ({ value, label: 'test', added: '2026-11-01' })
const random = (n: number): SecretEntry[] => Array.from({ length: n }, () => entry(randomBytes(24).toString('base64')))

test('a small list round-trips through the real store', { skip }, async () => {
  const list = [...random(3), entry('pässwörd "x" \\ 日本語')]
  await saveList(b, list)
  assert.deepEqual(await loadList(b), { entries: list })
})

test('a list of several pieces round-trips, and a smaller one replaces it', { skip }, async () => {
  const size = Math.ceil((b.pieceBytes * 2.5) / 100)
  if (b.pieceBytes > 64 * 1024) return // Windows takes its list in one piece; the case above covers it.
  const big = random(size)
  await saveList(b, big)
  assert.deepEqual((await loadList(b)).entries, big)
  const small = random(2)
  await saveList(b, small)
  assert.deepEqual((await loadList(b)).entries, small)
})

test('an empty list is a list', { skip }, async () => {
  await saveList(b, [])
  assert.deepEqual(await loadList(b), { entries: [] })
})
