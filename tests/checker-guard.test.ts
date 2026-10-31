// Guards on the checker's own source: it must run in the mod and under Node, so it
// imports nothing from Node, and it must never touch the network or the disk.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { speedSet } from '../tools/test-sets/speed.ts'

const root = path.join(import.meta.dirname, '..')
const dir = path.join(root, 'src', 'checker')

function sources(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? sources(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []))
}

const files = sources(dir)

test('there are checker sources to guard', () => {
  assert.ok(files.length >= 14, String(files.length))
})

test('src/checker imports only other files in src/checker', () => {
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1] as string
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${path.relative(root, f)} imports ${spec}`)
      assert.ok(path.resolve(path.dirname(f), spec).startsWith(dir), `${path.relative(root, f)} imports outside src/checker: ${spec}`)
    }
    assert.ok(!/\brequire\s*\(|\bimport\s*\(/.test(text), `${path.relative(root, f)} has a dynamic import`)
  }
})

test('src/checker has no network, disk, process, eval or WebAssembly use', () => {
  const banned: [string, RegExp][] = [
    ['node: module', /['"]node:/],
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /\bWebSocket\b/],
    ['process', /\bprocess\./],
    ['Buffer', /\bBuffer\b/],
    ['require', /\brequire\b/],
    ['eval', /\beval\s*\(/],
    ['new Function', /new\s+Function\b/],
    ['WebAssembly', /WebAssembly/],
    ['fs', /\bfs\./],
    ['child_process', /child_process/],
    ['console', /\bconsole\./],
    ['Deno/Bun', /\b(?:Deno|Bun)\./],
  ]
  // rules.generated.ts is data (strings from the rule file); its imports are checked above.
  for (const f of files.filter(x => !x.endsWith('rules.generated.ts'))) {
    // Comments may talk about these things; code may not.
    const code = fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .filter(l => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
      .join('\n')
    for (const [name, re] of banned) assert.ok(!re.test(code), `${path.relative(root, f)} uses ${name}`)
  }
})

test('the speed set holds the all-keywords item for step 2', () => {
  const item = speedSet().find(x => x.id === 'adversarial-all-keywords')
  assert.ok(item)
  assert.ok(item.text().length >= 1024 * 1024)
})

test('npm run measure exits 0', { timeout: 180_000 }, () => {
  const r = spawnSync(process.execPath, ['tools/measure/run.ts'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout.slice(-1500))
  for (const section of ['== 1. Rules', '== 2. Catch rate', '== 3. Code set', '== 4. False alarms', '== 5. Speed']) assert.ok(r.stdout.includes(section), section)
})

test('rules:build --check agrees the generated file is current', { timeout: 60_000 }, () => {
  const r = spawnSync(process.execPath, ['tools/rules/build.ts', '--check'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
