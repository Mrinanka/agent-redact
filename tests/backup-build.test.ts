// plugin/backup is the backup lock as an installed plugin ships it: compiled JavaScript for plain Node
// (spec §5.2, D-068). These guards keep it honest: it is exactly what `tsc` makes from the sources, it
// reaches no network, and it runs from a folder with spaces and an apostrophe in its name.

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backupPlan, sha256 } from '../tools/plugin/backup-build.ts'
import { listFiles } from '../tools/plugin/build.ts'
import { holdsFake, needlesFor } from '../tools/leak-test/detect.ts'
import { makeFake, seededSource } from '../tools/test-sets/fakes.ts'

const root = path.join(import.meta.dirname, '..')
const dir = path.join(root, 'plugin', 'backup')
let plan: ReturnType<typeof backupPlan>
before(() => {
  plan = backupPlan(root)
})

test('plugin/backup is exactly what the build makes from the sources', () => {
  assert.ok(plan.files.length > 25, String(plan.files.length))
  for (const f of plan.files) {
    const file = path.join(dir, ...f.rel.split('/'))
    assert.ok(fs.existsSync(file), `missing plugin/backup/${f.rel} (run npm run plugin:build)`)
    assert.equal(fs.readFileSync(file, 'utf8'), f.content, `plugin/backup/${f.rel} differs (run npm run plugin:build)`)
  }
  assert.deepEqual(plan.stale, [])
})

test('the manifest lists every file with its SHA-256 and the plugin version', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { version: string; files: Record<string, string> }
  const plugin = JSON.parse(fs.readFileSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }
  assert.equal(manifest.version, plugin.version)
  const others = listFiles(dir).map(f => path.relative(dir, f).split(path.sep).join('/')).filter(r => r !== 'manifest.json')
  assert.deepEqual(Object.keys(manifest.files).sort(), others.sort())
  for (const [rel, hash] of Object.entries(manifest.files)) assert.equal(sha256(fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8')), hash, rel)
})

test('the build is the same on every run, with LF line endings', () => {
  for (const f of listFiles(dir)) assert.ok(!fs.readFileSync(f, 'utf8').includes('\r'), path.relative(root, f))
})

test('it ships the licences beside the Gitleaks rules', () => {
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES']) assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), fs.readFileSync(path.join(root, name), 'utf8'), name)
  assert.match(fs.readFileSync(path.join(root, 'THIRD_PARTY_LICENSES'), 'utf8'), /plugin\/backup\/checker\/rules\.generated\.js/)
})

const js = (): string[] => listFiles(dir).filter(f => f.endsWith('.js'))
const code = (f: string): string => fs.readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

test('it imports only Node built-ins that cannot reach a network, and files inside plugin/backup', () => {
  const allowed = new Set(['node:fs', 'node:path', 'node:os', 'node:child_process', 'node:crypto'])
  for (const f of js()) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = (m[1] ?? m[2] ?? m[3]) as string
      if (spec.startsWith('node:')) assert.ok(allowed.has(spec), `${path.relative(root, f)} imports ${spec}`)
      else {
        assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${path.relative(root, f)} imports ${spec}`)
        assert.ok(path.resolve(path.dirname(f), spec).startsWith(dir + path.sep), `${path.relative(root, f)} imports outside plugin/backup: ${spec}`)
      }
    }
  }
})

test('it never contacts the network, evaluates text or loads native code', () => {
  const banned: [string, RegExp][] = [
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /\bWebSocket\b/],
    ['http', /node:(?:https?|net|tls|dns|dgram|http2)\b/],
    ['eval', /\beval\s*\(/],
    ['new Function', /new\s+Function\b/],
    ['WebAssembly', /WebAssembly/],
    ['require', /\brequire\s*\(/],
  ]
  for (const f of js()) for (const [name, re] of banned) assert.ok(!re.test(code(f)), `${path.relative(root, f)} uses ${name}`)
})

test('the build runs from a folder with spaces and an apostrophe, started in exec form with no shell', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "it's a back up "))
  try {
    const copy = path.join(base, 'secret shield', 'backup')
    for (const f of listFiles(dir)) {
      const to = path.join(copy, path.relative(dir, f))
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(f, to)
    }
    const cfg = path.join(base, 'config')
    fs.mkdirSync(cfg)
    const fake = makeFake('github-pat', seededSource('backup-build')).value
    const r = spawnSync(process.execPath, [path.join(copy, 'backup', 'main.js')], {
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's-build', cwd: base, prompt: `token ${fake}` }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
      encoding: 'utf8',
    })
    assert.equal(r.status, 0, r.stderr)
    assert.equal((JSON.parse(r.stdout) as { decision: string }).decision, 'block')
    assert.ok(!holdsFake(r.stdout + r.stderr, needlesFor('f', fake)))
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
