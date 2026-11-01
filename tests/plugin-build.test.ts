// The plugin gets no build step when it is installed, so the checker and core sources are copied into
// plugin/hooks/lib/ and committed (tools/plugin/build.ts). These guards keep the copy honest and the
// plugin free of Node.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildPlan, listFiles } from '../tools/plugin/build.ts'

const root = path.join(import.meta.dirname, '..')
const plugin = path.join(root, 'plugin')

test('plugin/hooks/lib is exactly a copy of src/checker and src/core', () => {
  const plan = buildPlan(root)
  assert.ok(plan.files.length > 20, `${plan.files.length} files`)
  for (const f of plan.files) {
    assert.ok(fs.existsSync(f.to), `missing ${path.relative(root, f.to)} (run npm run plugin:build)`)
    assert.equal(fs.readFileSync(f.to, 'utf8'), f.content, `${path.relative(root, f.to)} differs (run npm run plugin:build)`)
  }
  assert.deepEqual(plan.stale, [], 'files in lib/ that no source makes')
})

test('the copies are byte for byte the sources: line endings included', () => {
  for (const f of buildPlan(root).files) {
    assert.equal(Buffer.compare(fs.readFileSync(f.to), fs.readFileSync(f.from)), 0, path.relative(root, f.to))
  }
})

// plugin/backup is the backup lock's compiled Node code, not a mod: its own guards are in tests/backup-build.test.ts.
const sources = listFiles(plugin).filter(f => /\.(ts|tsx|js|mjs)$/.test(f) && !f.includes(`${path.sep}.claude-plugin${path.sep}`) && !f.startsWith(path.join(plugin, 'backup') + path.sep))

test('the marker reports the version in plugin.json', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }
  assert.ok(fs.readFileSync(path.join(plugin, 'hooks', 'marker.ts'), 'utf8').includes(`PLUGIN_VERSION = '${manifest.version}'`))
})

test('the plugin carries its licences and credits the Gitleaks copy it ships', () => {
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES']) {
    assert.equal(fs.readFileSync(path.join(plugin, name), 'utf8'), fs.readFileSync(path.join(root, name), 'utf8'), name)
  }
  assert.match(fs.readFileSync(path.join(plugin, 'THIRD_PARTY_LICENSES'), 'utf8'), /plugin\/hooks\/lib\/checker\/rules\.generated\.ts/)
})

test('there are plugin sources to guard', () => {
  assert.ok(sources.length >= 6, String(sources.length))
})

test('no file of the plugin imports Node, and every import stays inside plugin/', () => {
  for (const f of sources) {
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
      const spec = (m[1] ?? m[2]) as string
      assert.ok(!spec.startsWith('node:'), `${path.relative(root, f)} imports ${spec}`)
      if (spec === 'claude-code' || spec === 'claude-code/testing') continue
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${path.relative(root, f)} imports ${spec}`)
      assert.ok(path.resolve(path.dirname(f), spec).startsWith(plugin + path.sep), `${path.relative(root, f)} imports outside plugin/: ${spec}`)
    }
    assert.ok(!/\bimport\s*\(/.test(text.replace(/^\s*(\/\/|\*).*$/gm, '')), `${path.relative(root, f)} has a dynamic import`)
  }
})

// Node's `process`. `$.process` is Claude Code's own API, the plugin's only way to the OS password store.
const NODE_PROCESS = /(?<![$\w.'])process\./

test('the process check tells Node from the engine', () => {
  for (const code of ['process.env.HOME', 'const a = process.argv', '(process.exit(1))', 'await process.stdout.write(x)']) assert.ok(NODE_PROCESS.test(code), code)
  for (const code of ['$.process.run(argv)', 'await $.process.spawn(x)', 'myprocess.run()', "on('process.run', hook)"]) assert.ok(!NODE_PROCESS.test(code), code)
})

test('the plugin uses no Node globals, network, eval or WebAssembly', () => {
  const banned: [string, RegExp][] = [
    ['process', NODE_PROCESS],
    ['Buffer', /\bBuffer\b/],
    ['require', /\brequire\s*\(/],
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /\bWebSocket\b/],
    ['eval', /\beval\s*\(/],
    ['new Function', /new\s+Function\b/],
    ['WebAssembly', /WebAssembly/],
    ['console', /\bconsole\./],
  ]
  for (const f of sources.filter(x => !x.endsWith('rules.generated.ts'))) {
    const code = fs.readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    for (const [name, re] of banned) assert.ok(!re.test(code), `${path.relative(root, f)} uses ${name}`)
  }
})
