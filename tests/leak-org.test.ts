// The kit's guarded and organization modes (plan step 6): the managed settings of an organization install, the
// folder marketplace it points at, and the proof from Claude Code's debug log that the tool really sat in the tier
// under test. A log without that proof makes a run invalid, never clean. The real runs are
// `npm run leak-test:org` and `leak-test:guarded`, in CI only (they write the machine's managed settings file).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runKit, type KitOptions } from '../tools/leak-test/kit.ts'
import { GUARDED_OPEN, ORG_SCENARIOS, buildMarketplaceFolder, orgManagedContent, tierProblem } from '../tools/leak-test/org.ts'
import { SCENARIOS } from '../tools/leak-test/scenarios.ts'
import type { Scenario } from '../tools/leak-test/scenarios.ts'

const STAND_IN = path.join(import.meta.dirname, 'fixtures', 'stand-in-claude.mjs')
const RUN = path.join(import.meta.dirname, '..', 'tools', 'leak-test', 'run.ts')
const ROOT = path.join(import.meta.dirname, '..')

const ORG_LOG = [
  '2026-11-01T10:00:00.000Z [DEBUG] cc-plugin-sec-default@builtin seated by managed prependPlugins at position 2',
  '2026-11-01T10:00:01.000Z [DEBUG] hooks module aegiscontext@aegiscontext loaded (worker, environment 1, tier prepend); events: session.append,prompt.submit',
].join('\n')
const GUARDED_LOG = [
  '2026-11-01T10:00:00.000Z [DEBUG] cc-plugin-sec-default@builtin seated outermost: this machine has managed settings',
  '2026-11-01T10:00:01.000Z [DEBUG] hooks module aegiscontext@inline loaded (worker, environment 1, tier user); events: session.append,prompt.submit',
].join('\n')

test('org proof: the tool in tier prepend and the built-in guard seated by the list is fine', () => {
  assert.equal(tierProblem(ORG_LOG, 'org'), undefined)
})

test('org proof: a log that says "not seated" is a problem, even with the tool in prepend', () => {
  const log = `${ORG_LOG}\n2026-11-01T10:00:02.000Z [DEBUG] cc-plugin-sec-default@builtin not seated: managed prependPlugins does not list it`
  assert.match(tierProblem(log, 'org') ?? '', /not seated/)
})

test('org proof: the tool in the user tier, or not loaded at all, is a problem', () => {
  assert.match(tierProblem(ORG_LOG.replace('tier prepend', 'tier user'), 'org') ?? '', /tier user/)
  assert.match(tierProblem('nothing useful here', 'org') ?? '', /never loaded/)
  assert.match(tierProblem('', 'org') ?? '', /never loaded/)
})

test('guarded proof: the tool in the user tier on a machine where the guard is seated', () => {
  assert.equal(tierProblem(GUARDED_LOG, 'guarded'), undefined)
  assert.match(tierProblem(GUARDED_LOG.replace('tier user', 'tier prepend'), 'guarded') ?? '', /tier prepend/)
  assert.match(tierProblem(GUARDED_LOG.replace('seated outermost', 'not seated'), 'guarded') ?? '', /not seated/)
})

test('guarded proof: a guard that never logged is a problem too', () => {
  const noGuard = GUARDED_LOG.split('\n').slice(1).join('\n')
  assert.match(tierProblem(noGuard, 'guarded') ?? '', /guard/)
})

test('the organization settings: a folder marketplace, the plugin enabled, and the guard listed after it', () => {
  const dir = path.join(os.tmpdir(), 'org folder', 'market')
  const c = orgManagedContent(dir)
  assert.deepEqual(c.extraKnownMarketplaces.aegiscontext, { source: { source: 'directory', path: dir } })
  assert.deepEqual(c.enabledPlugins, { 'aegiscontext@aegiscontext': true })
  assert.deepEqual(c.prependPlugins, ['aegiscontext@aegiscontext', 'sec-default@builtin'])
})

test('the folder marketplace holds the manifest and the plugin, also at a path with spaces', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'org market-'))
  try {
    const dir = path.join(base, 'a folder')
    buildMarketplaceFolder(dir, ROOT)
    const m = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), 'utf8')) as { plugins: { name: string; source: string }[] }
    assert.equal(m.plugins[0]?.source, './plugin')
    assert.ok(fs.existsSync(path.join(dir, 'plugin', '.claude-plugin', 'plugin.json')))
    assert.ok(fs.existsSync(path.join(dir, 'plugin', 'hooks', 'hooks.json')))
    assert.ok(!fs.existsSync(path.join(dir, 'plugin', '.claude-plugin', 'types')), 'a types folder written by a loaded mod is not copied')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('the scenario sets: the org run skips the resume door, which needs a run without the tool, and every name is real, doors as scenario/door', () => {
  const names = new Set(SCENARIOS.map(s => s.name))
  for (const n of ORG_SCENARIOS) assert.ok(names.has(n), n)
  const doors = new Set(SCENARIOS.flatMap(s => s.doors.map(d => `${s.name}/${d}`)))
  for (const d of GUARDED_OPEN) assert.ok(doors.has(d), d)
  assert.ok(!ORG_SCENARIOS.includes('resume'))
})

// ---- the kit with a stand-in -----------------------------------------------------------------

const PROMPT: Scenario[] = [
  { name: 'prompt', doors: ['typed'], runs: [{ prompt: c => `Note:\n${c.block('typed')}`, script: () => () => ({ kind: 'text', text: 'ok' }) }] },
]
const opts = (mode: string, extra: Partial<KitOptions> = {}): KitOptions => ({
  claude: { cmd: process.execPath, args: [STAND_IN, mode] },
  plugin: null,
  expect: 'clean',
  scenarios: PROMPT,
  timeoutMs: 20_000,
  ...extra,
})

test('a run whose debug log proves the tier is judged by what the model saw', async () => {
  const r = await runKit(opts('debug-log', { tierProof: 'org', extraEnv: { STAND_IN_DEBUG: ORG_LOG } }))
  assert.equal(r.verdict, 'pass')
})

test('a run whose debug log lacks the proof is invalid, never clean', async () => {
  for (const log of ['', ORG_LOG.replace('tier prepend', 'tier user'), `${ORG_LOG}\ncc-plugin-sec-default@builtin not seated: x`]) {
    const r = await runKit(opts('debug-log', { tierProof: 'org', extraEnv: { STAND_IN_DEBUG: log } }))
    assert.equal(r.verdict, 'invalid', log)
  }
})

test('a run with no debug file at all is invalid', async () => {
  const r = await runKit(opts('hide-all', { tierProof: 'org' }))
  assert.equal(r.verdict, 'invalid')
})

test('--debug-file reaches the claude command line only when a proof is asked for', async () => {
  const file = path.join(os.tmpdir(), `args-org-${process.pid}.json`)
  try {
    await runKit(opts('save-args', { tierProof: 'org', extraEnv: { STAND_IN_ENV_FILE: file } }))
    assert.ok((JSON.parse(fs.readFileSync(file, 'utf8')) as string[]).includes('--debug-file'))
    await runKit(opts('save-args', { extraEnv: { STAND_IN_ENV_FILE: file } }))
    assert.ok(!(JSON.parse(fs.readFileSync(file, 'utf8')) as string[]).includes('--debug-file'))
  } finally {
    fs.rmSync(file, { force: true })
  }
})

test('a door the guard is expected to pass over must leak: a clean result there is blind, so the list cannot go stale', async () => {
  const leaky = opts('send-all', { expectFor: () => 'leaks' })
  assert.equal((await runKit(leaky)).verdict, 'pass')
  const hidden = opts('hide-all', { expectFor: () => 'leaks' })
  assert.notEqual((await runKit(hidden)).verdict, 'pass')
})

test('a door expected clean still fails when a fake is seen, whatever the other doors expect', async () => {
  const r = await runKit(opts('send-all', { expectFor: () => 'clean' }))
  assert.equal(r.verdict, 'leak')
})

// ---- the command line --------------------------------------------------------------------------

const cli = (...args: string[]) => spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8', timeout: 60_000 })

test('--org and --guarded write the managed file, so they need --allow-managed-file', () => {
  for (const mode of ['--org', '--guarded']) {
    const r = cli(mode, '--claude', process.execPath)
    assert.equal(r.status, 2, mode)
    assert.match(r.stderr, /--allow-managed-file/, mode)
  }
})

test('--org and --guarded exclude each other and the backup modes', () => {
  assert.equal(cli('--org', '--guarded', '--allow-managed-file').status, 2)
  assert.equal(cli('--org', '--no-plugin', '--backup', 'user', '--allow-managed-file').status, 2)
  assert.equal(cli('--guarded', '--no-plugin', '--allow-managed-file').status, 2)
})
