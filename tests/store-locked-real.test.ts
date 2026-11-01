// A really locked Keychain or keyring (progress, Known issues). It changes the machine's default
// keychain, so it only runs where CI asks for it with STORE_LOCK_TEST=1. Exit codes print; no values do.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backendFor } from '../src/core/backends.ts'
import { loadList, saveList } from '../src/core/store.ts'
import { nodeExec, nodeFiles, thisOS } from '../tools/measure/store.ts'

const on = process.env.STORE_LOCK_TEST === '1' && (process.platform === 'darwin' || process.platform === 'linux')
const skip = on ? false : 'needs STORE_LOCK_TEST=1 on macOS or Linux'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-locked-'))
const run = (...argv: string[]) => spawnSync(argv[0] as string, argv.slice(1), { encoding: 'utf8' })
const keychain = path.join(dir, 'locked-test.keychain-db')
let oldDefault = ''
let oldList: string[] = []

after(() => {
  if (on && process.platform === 'darwin') {
    if (oldDefault) run('security', 'default-keychain', '-s', oldDefault)
    if (oldList.length > 0) run('security', 'list-keychains', '-s', ...oldList)
    run('security', 'delete-keychain', keychain)
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a saved list in a really locked store warns and loads nothing, and loads again once unlocked', { skip }, async () => {
  const b = backendFor(thisOS(), { exec: nodeExec, files: nodeFiles(dir), service: `secret-shield-test-${randomUUID()}` })
  const list = [{ value: randomBytes(18).toString('base64'), label: 'test', added: '2026-11-01' }]
  const pass = randomBytes(9).toString('hex')
  if (process.platform === 'darwin') {
    oldDefault = run('security', 'default-keychain').stdout.trim().replace(/"/g, '')
    oldList = run('security', 'list-keychains').stdout.split('\n').map(l => l.trim().replace(/"/g, '')).filter(Boolean)
    assert.equal(run('security', 'create-keychain', '-p', pass, keychain).status, 0)
    assert.equal(run('security', 'unlock-keychain', '-p', pass, keychain).status, 0)
    assert.equal(run('security', 'list-keychains', '-s', keychain).status, 0)
    assert.equal(run('security', 'default-keychain', '-s', keychain).status, 0)
  }
  await saveList(b, list)
  assert.deepEqual((await loadList(b)).entries, list)
  const lock = process.platform === 'darwin' ? run('security', 'lock-keychain', keychain) : run('secret-tool', 'lock', '--collections')
  console.log(`lock exit ${lock.status}`)
  assert.equal(lock.status, 0)
  const locked = await loadList(b)
  console.log(`locked read: entries ${locked.entries.length}, unavailable ${locked.unavailable ?? '-'}, warned ${locked.warning !== undefined}`)
  assert.deepEqual(locked.entries, [])
  assert.ok(locked.warning)
  if (process.platform === 'darwin') {
    assert.equal(run('security', 'unlock-keychain', '-p', pass, keychain).status, 0)
    assert.deepEqual((await loadList(b)).entries, list)
  }
  await saveList(b, [])
})
