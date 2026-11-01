// How the backup lock finds its settings (spec §14, §5.2): the user, project, local and managed files, plus
// `--policy <file>` for a managed setting that arrives by MDM or from the server, which a process can't read.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadBackupSettings, managedLocation, nodeSettingsIO, type SettingsIO } from '../src/backup/settings.ts'

/** A fake disk: paths to text. A path mapped to `null` throws on read, like an unreadable file. */
function disk(files: Record<string, string | null>): SettingsIO {
  return {
    read: p => {
      if (!(p in files)) return undefined
      if (files[p] === null) throw new Error('EACCES')
      return files[p] as string
    },
    list: d => {
      const names = Object.keys(files).filter(f => path.dirname(f) === path.normalize(d)).map(f => path.basename(f))
      return names.length > 0 ? names : undefined
    },
  }
}

const CFG = path.join(os.tmpdir(), 'cfg')
const CWD = path.join(os.tmpdir(), 'proj')
const ss = (o: unknown): string => JSON.stringify({ aegisContext: o })
const userFile = path.join(CFG, 'settings.json')
const projFile = path.join(CWD, '.claude', 'settings.json')
const localFile = path.join(CWD, '.claude', 'settings.local.json')
const load = (files: Record<string, string | null>, extra: Partial<Parameters<typeof loadBackupSettings>[0]> = {}) =>
  loadBackupSettings({ configDir: CFG, cwd: CWD, platform: 'linux', policyFiles: [], io: disk(files), ...extra })

test('with no files at all, the defaults apply and nothing is a problem', () => {
  const r = load({})
  assert.equal(r.settings.on_check_failure, 'allow')
  assert.equal(r.settings.outbound, 'block')
  assert.deepEqual(r.problems, [])
})

test('user, project and local files are read from the config folder and the working folder', () => {
  const r = load({ [userFile]: ss({ hints: 'off' }), [projFile]: ss({ on_check_failure: 'hold' }), [localFile]: ss({ media: 'drop' }) })
  assert.equal(r.settings.hints, 'off')
  assert.equal(r.settings.on_check_failure, 'hold')
  assert.equal(r.settings.media, 'drop')
})

test('a project can make things stricter but not weaker', () => {
  const r = load({ [userFile]: ss({ on_check_failure: 'hold', outbound: 'block' }), [projFile]: ss({ on_check_failure: 'allow', outbound: 'off', mode: 'observe' }) })
  assert.equal(r.settings.on_check_failure, 'hold')
  assert.equal(r.settings.outbound, 'block')
  assert.equal(r.settings.mode, 'enforce')
})

test('a file with other settings and no aegisContext key is fine', () => {
  const r = load({ [userFile]: JSON.stringify({ theme: 'dark', hooks: {} }) })
  assert.deepEqual(r.problems, [])
})

test('managed settings lock a setting against the user', () => {
  const m = managedLocation('linux')
  const r = load({ [m.file]: ss({ on_check_failure: 'hold', locked: ['on_check_failure'] }), [userFile]: ss({ on_check_failure: 'allow' }) })
  assert.equal(r.settings.on_check_failure, 'hold')
})

test('managed-settings.d files are merged after managed-settings.json, in alphabetical order; hidden and non-json files are ignored', () => {
  const m = managedLocation('linux')
  const r = load({
    [m.file]: ss({ outbound: 'warn', media: 'drop' }),
    [path.join(m.dir, '20-b.json')]: ss({ outbound: 'ask' }),
    [path.join(m.dir, '10-a.json')]: ss({ outbound: 'block', hints: 'off' }),
    [path.join(m.dir, '.hidden.json')]: ss({ hints: 'on' }),
    [path.join(m.dir, 'notes.txt')]: 'x',
  })
  assert.equal(r.settings.outbound, 'ask')
  assert.equal(r.settings.media, 'drop')
  assert.equal(r.settings.hints, 'off')
})

test('where the managed file lives on each system', () => {
  assert.equal(managedLocation('win32').file, path.join('C:\\Program Files\\ClaudeCode', 'managed-settings.json'))
  assert.equal(managedLocation('darwin').file, path.join('/Library/Application Support/ClaudeCode', 'managed-settings.json'))
  assert.equal(managedLocation('linux').file, path.join('/etc/claude-code', 'managed-settings.json'))
  assert.equal(managedLocation('freebsd' as NodeJS.Platform).dir, '/etc/claude-code')
})

test('--policy files are read as managed settings, after the system files', () => {
  const pol = path.join(os.tmpdir(), 'policy.json')
  const m = managedLocation('linux')
  const r = load({ [pol]: ss({ on_check_failure: 'hold', locked: ['on_check_failure'] }), [m.file]: ss({ media: 'drop' }), [userFile]: ss({ on_check_failure: 'allow' }) }, { policyFiles: [pol] })
  assert.equal(r.settings.on_check_failure, 'hold')
  assert.equal(r.settings.media, 'drop')
})

test('a missing --policy file is a problem and makes failures hold, because the admin meant something', () => {
  const r = load({}, { policyFiles: [path.join(os.tmpdir(), 'nope.json')] })
  assert.ok(r.problems.some(p => p.includes('policy')))
  assert.equal(r.settings.on_check_failure, 'hold')
})

test('a broken project file is left out on its own and does not freeze the rest', () => {
  const r = load({ [userFile]: ss({ hints: 'off' }), [projFile]: '{ nope', [localFile]: ss({ media: 'drop' }) })
  assert.ok(r.problems.some(p => p.startsWith('project:')))
  assert.equal(r.settings.hints, 'off')
  assert.equal(r.settings.media, 'drop')
})

test('a broken user file falls back to the defaults and says so', () => {
  const r = load({ [userFile]: '{ nope' })
  assert.ok(r.problems.some(p => p.startsWith('user:')))
  assert.equal(r.settings.outbound, 'block')
})

test('a broken managed file means failures hold', () => {
  const m = managedLocation('linux')
  for (const bad of ['{ nope', '[]', '"x"', null]) {
    const r = load({ [m.file]: bad })
    assert.ok(r.problems.some(p => p.startsWith('policy:')), String(bad))
    assert.equal(r.settings.on_check_failure, 'hold', String(bad))
  }
})

test('a broken drop-in file also counts as a broken managed source', () => {
  const m = managedLocation('linux')
  const r = load({ [m.file]: ss({ media: 'drop' }), [path.join(m.dir, '10-x.json')]: '{ nope' })
  assert.ok(r.problems.some(p => p.startsWith('policy:')))
  assert.equal(r.settings.on_check_failure, 'hold')
})

test('a bad value in one setting is a problem for that source, with no value in the text', () => {
  const r = load({ [userFile]: ss({ outbound: 'sideways' }) })
  assert.ok(r.problems.some(p => p.startsWith('user:')))
  assert.ok(!r.problems.join(' ').includes('sideways'))
})

test('a file over 1 MiB is not read whole: it is a broken source', () => {
  const r = load({ [userFile]: ss({ allow: ['x'.repeat(2_000_000)] }) })
  assert.ok(r.problems.some(p => p.startsWith('user:')))
})

test('personal_data on reaches the settings with no notice', () => {
  const r = load({ [userFile]: ss({ personal_data: 'on' }) })
  assert.equal(r.settings.personal_data, 'on')
  assert.ok(!r.notices.some(n => /not available/.test(n)))
})

test('the Node reader reads real files, treats a missing one as absent and a folder as unreadable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-'))
  try {
    fs.writeFileSync(path.join(dir, 'a.json'), '{"x":1}')
    fs.mkdirSync(path.join(dir, 'd.json'))
    assert.equal(nodeSettingsIO.read(path.join(dir, 'a.json')), '{"x":1}')
    assert.equal(nodeSettingsIO.read(path.join(dir, 'missing.json')), undefined)
    assert.throws(() => nodeSettingsIO.read(path.join(dir, 'd.json')))
    assert.deepEqual(nodeSettingsIO.list(dir)?.sort(), ['a.json', 'd.json'])
    assert.equal(nodeSettingsIO.list(path.join(dir, 'missing')), undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
