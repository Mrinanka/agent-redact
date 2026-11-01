// The locked-store gap (progress, Known issues): a list exists, the store can't be read, and that must
// never pass for "no list". `saveList` leaves a small non-secret flag, and `hasList()` answers from it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadList, saveList, type SecretEntry } from '../src/core/store.ts'
import { backendFor, type Exec, type Files, type StoreOS } from '../src/core/backends.ts'

const VALUE = ['Zq7', 'locked', 'Kd93mLx'].join('-')
const list: SecretEntry[] = [{ value: VALUE, label: 'token', added: '2026-11-01' }]

function memoryFiles(): Files & { held: Map<string, string> } {
  const held = new Map<string, string>()
  return { held, read: async p => held.get(p) ?? '', write: async (p, t) => void held.set(p, t), exists: async p => held.has(p), path: n => `store/${n}.dpapi` }
}

/** A keychain or keyring in memory that can be locked. */
function world(os: 'macos' | 'linux'): { exec: Exec; files: ReturnType<typeof memoryFiles>; lock: (on: boolean) => void; os: StoreOS; calls: () => number } {
  const items = new Map<string, string>()
  let locked = false
  let calls = 0
  const exec: Exec = async (argv, init) => {
    calls++
    const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' })
    if (os === 'macos') {
      if (argv[1] === 'default-keychain') return ok('login')
      if (argv[1] === '-i') {
        const m = /-a (\S+) .* -w "([^"]*)"/.exec(init?.stdin ?? '') as RegExpExecArray
        items.set(m[1] as string, m[2] as string)
        return ok()
      }
      const name = argv[argv.indexOf('-a') + 1] as string
      if (argv[1] === 'find-generic-password') {
        if (locked) return { exitCode: 36, stdout: '', stderr: 'interaction not allowed' }
        return items.has(name) ? ok(items.get(name)) : { exitCode: 44, stdout: '', stderr: '' }
      }
      items.delete(name)
      return ok()
    }
    const name = argv[argv.indexOf('account') + 1] as string
    if (argv[1] === 'store') {
      items.set(name, init?.stdin ?? '')
      return ok()
    }
    if (argv[1] === 'lookup') {
      // The worst case: a locked keyring that answers like "no such item".
      if (locked) return { exitCode: 1, stdout: '', stderr: '' }
      return items.has(name) ? ok(items.get(name)) : { exitCode: 1, stdout: '', stderr: '' }
    }
    items.delete(name)
    return ok()
  }
  return { exec, files: memoryFiles(), lock: on => void (locked = on), os, calls: () => calls }
}

for (const os of ['macos', 'linux'] as const) {
  test(`${os}: a locked store with a list warns, and says no secrets were loaded`, async () => {
    const w = world(os)
    const b = backendFor(os, w)
    await saveList(b, list)
    w.lock(true)
    const out = await loadList(b)
    assert.deepEqual(out.entries, [])
    assert.ok(out.warning, 'must warn')
    assert.equal(out.unavailable, 'locked')
    assert.ok(!(out.warning as string).includes(VALUE))
  })

  test(`${os}: unlocked again, the same list loads`, async () => {
    const w = world(os)
    const b = backendFor(os, w)
    await saveList(b, list)
    w.lock(true)
    await loadList(b)
    w.lock(false)
    assert.deepEqual((await loadList(b)).entries, list)
  })

  test(`${os}: no list ever saved stays quiet`, async () => {
    const w = world(os)
    assert.deepEqual(await loadList(backendFor(os, w)), { entries: [] })
  })

  test(`${os}: an emptied list clears the flag, so a later failure is quiet again`, async () => {
    const w = world(os)
    const b = backendFor(os, w)
    await saveList(b, list)
    await saveList(b, [])
    w.lock(true)
    assert.equal((await loadList(b)).warning, undefined)
  })

  test(`${os}: the flag file holds nothing of the list`, async () => {
    const w = world(os)
    await saveList(backendFor(os, w), list)
    assert.equal(w.files.held.size, 1)
    const [text] = [...w.files.held.values()]
    assert.equal(text, '1\n')
  })
}

test('the flag goes down before the index, so a save that dies at the index still warns if the store locks', async () => {
  const w = world('linux')
  const b = backendFor('linux', w)
  const order: string[] = []
  const put = b.put
  b.put = async (n, t) => {
    order.push(`put ${n}`)
    return put(n, t)
  }
  const mark = b.markList?.bind(b)
  b.markList = async on => {
    order.push(`mark ${on}`)
    await mark?.(on)
  }
  await saveList(b, list)
  assert.ok(order.indexOf('mark true') < order.indexOf('put index'))
})

test('a failed read of a list that exists reports locked, so the caller retries', async () => {
  const w = world('macos')
  const b = backendFor('macos', w)
  await saveList(b, list)
  b.get = async () => {
    throw new Error('timed out')
  }
  assert.equal((await loadList(b)).unavailable, 'locked')
})
