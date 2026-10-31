// The kit's core (tools/leak-test/kit.ts), driven by a scripted stand-in for
// `claude`, so it runs in `npm test`. The real run against Claude Code is
// `npm run leak-test:baseline`, in CI on 3 OSes.
//
// What matters: the kit tells leaked from clean, and "nothing ran" from clean.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertNoFakes, exitCodeFor, KitError, runKit, type KitOptions, type Report } from '../tools/leak-test/kit.ts'
import { needlesFor } from '../tools/leak-test/detect.ts'
import { resolveClaude } from '../tools/leak-test/claude-bin.ts'
import type { Scenario } from '../tools/leak-test/scenarios.ts'

const STAND_IN = path.join(import.meta.dirname, 'fixtures', 'stand-in-claude.mjs')
const RUN = path.join(import.meta.dirname, '..', 'tools', 'leak-test', 'run.ts')

const standIn = (mode: string): KitOptions['claude'] => ({ cmd: process.execPath, args: [STAND_IN, mode] })

// Two doors the stand-in can reach: the prompt and a file.
const SCENARIOS: Scenario[] = [
  {
    name: 'prompt',
    doors: ['typed'],
    runs: [{ prompt: c => `Note:\n${c.block('typed')}\nReply.`, script: () => () => ({ kind: 'text', text: 'ok' }) }],
  },
  {
    name: 'file',
    doors: ['notes'],
    files: c => ({ 'notes.txt': `start\n${c.block('notes')}\nend\n` }),
    runs: [{ prompt: () => 'Read notes.txt', script: () => () => ({ kind: 'text', text: 'ok' }) }],
  },
]

function base(mode: string, expect: KitOptions['expect'], extra: Partial<KitOptions> = {}): KitOptions {
  return { claude: standIn(mode), plugin: null, expect, scenarios: SCENARIOS, timeoutMs: 20_000, ...extra }
}

const hits = (r: Report) => r.doors.flatMap(d => d.fakes).filter(f => f.leaked).length
const total = (r: Report) => r.doors.flatMap(d => d.fakes).length

test('baseline: an empty tool leaks every fake, and that is a pass', async () => {
  const r = await runKit(base('send-all', 'leaks'))
  assert.equal(r.verdict, 'pass')
  assert.equal(exitCodeFor(r), 0)
  assert.equal(r.doors.length, 2)
  assert.ok(total(r) >= 12)
  assert.equal(hits(r), total(r))
  assert.ok(r.doors.every(d => d.verdict === 'pass' && d.witnessSeen))
})

test('every door plants fakes in plain and encoded forms', async () => {
  const r = await runKit(base('send-all', 'leaks'))
  const forms = new Set(r.doors[0]?.fakes.map(f => f.plantedAs))
  assert.deepEqual([...forms].sort(), ['base64', 'json-escaped', 'plain', 'url'])
})

test('baseline: a fake the kit could not see is "blind", and the run fails', async () => {
  const r = await runKit(base('hide-one', 'leaks'))
  assert.equal(r.verdict, 'blind')
  assert.equal(exitCodeFor(r), 1)
  assert.ok(r.doors.every(d => d.verdict === 'blind'))
  assert.equal(hits(r), total(r) - 2)
})

test('clean: a tool that hides everything passes', async () => {
  const r = await runKit(base('hide-all', 'clean'))
  assert.equal(r.verdict, 'pass')
  assert.equal(exitCodeFor(r), 0)
  assert.equal(hits(r), 0)
})

test('clean: any hit fails, and names the door, fake kind and form', async () => {
  const r = await runKit(base('hide-one', 'clean'))
  assert.equal(r.verdict, 'leak')
  assert.equal(exitCodeFor(r), 1)
  const leaked = r.doors[0]?.fakes.find(f => f.leaked)
  assert.ok(leaked)
  assert.deepEqual(leaked.parts, ['messages'])
  assert.ok(leaked.forms.length > 0)
})

test('nothing ran is never clean: no witness makes the door invalid', async () => {
  const r = await runKit(base('send-nothing', 'clean'))
  assert.equal(r.verdict, 'invalid')
  assert.equal(exitCodeFor(r), 2)
  assert.ok(r.doors.every(d => d.verdict === 'invalid' && !d.witnessSeen))
})

test('no scenarios is never a pass', async () => {
  const r = await runKit(base('send-all', 'clean', { scenarios: [] }))
  assert.equal(r.verdict, 'invalid')
})

test('a run that exits non-zero is invalid, even when its requests looked fine', async () => {
  const r = await runKit(base('exit-3', 'leaks'))
  assert.equal(r.verdict, 'invalid')
  assert.equal(r.runs[0]?.exit, 3)
})

test('timeout: a run that hangs is killed and invalid', async () => {
  const t0 = Date.now()
  const r = await runKit(base('hang', 'clean', { timeoutMs: 1500 }))
  assert.equal(r.verdict, 'invalid')
  assert.ok(r.runs.every(x => x.timedOut))
  assert.ok(Date.now() - t0 < 15_000)
})

test('a network attempt makes the run invalid and names the host', async () => {
  const r = await runKit(base('network', 'leaks'))
  assert.equal(r.verdict, 'invalid')
  assert.deepEqual([...new Set(r.network.attempts.map(a => a.host))], ['telemetry.example.test:443'])
})

test('a gzip body is searched', async () => {
  const r = await runKit(base('gzip', 'leaks'))
  assert.equal(r.verdict, 'pass')
})

test('a body the kit cannot read makes the run invalid, never clean', async () => {
  const r = await runKit(base('unknown-encoding', 'clean'))
  assert.equal(r.verdict, 'invalid')
  assert.equal(r.unreadable, 2)
})

test('one unreadable body makes the run invalid, even when every witness was seen', async () => {
  const r = await runKit(base('one-unreadable', 'leaks', { scenarios: [SCENARIOS[0]!] }))
  assert.ok(r.doors.every(d => d.witnessSeen))
  assert.equal(r.unreadable, 1)
  assert.equal(r.verdict, 'invalid')
})

test('the report guard refuses a report that holds any form of a fake', () => {
  const value = 'Zq7-guard-value-0123456789'
  const needles = needlesFor('f', value)
  assert.throws(() => assertNoFakes(JSON.stringify({ note: value }), needles), /not printed/)
  assert.throws(() => assertNoFakes(JSON.stringify({ note: Buffer.from(value).toString('base64') }), needles), /not printed/)
  assert.doesNotThrow(() => assertNoFakes(JSON.stringify({ note: 'labels only' }), needles))
})

test('a door can count only from a later run (a session recorded without the tool)', async () => {
  const resume: Scenario[] = [{
    name: 'resume',
    doors: ['history'],
    countFromRun: 1,
    runs: [
      { prompt: c => c.block('history'), withoutPlugin: true, script: () => () => ({ kind: 'text', text: 'ok' }) },
      { prompt: () => 'witness-free reply please', script: () => () => ({ kind: 'text', text: 'ok' }) },
    ],
  }]
  const r = await runKit(base('send-all', 'clean', { scenarios: resume }))
  // The first run leaks and the second sends nothing of it, so the door was not exercised.
  assert.equal(hits(r), 0)
  assert.equal(r.doors[0]?.witnessSeen, false)
  assert.equal(r.verdict, 'invalid')
})

test('the plugin is left out of a run marked withoutPlugin, and passed otherwise', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-plugin-'))
  const seen = path.join(dir, 'args.json')
  try {
    const shim = path.join(dir, 'shim.mjs')
    fs.writeFileSync(shim, `import fs from 'node:fs'\nif (process.argv.includes('--version')) { console.log('2.1.316 (Claude Code)'); process.exit(0) }\nfs.appendFileSync(${JSON.stringify(seen)}, JSON.stringify(process.argv.slice(2)) + '\\n')\n`)
    const scenarios: Scenario[] = [{
      name: 's',
      doors: ['d'],
      runs: [
        { prompt: () => 'a', withoutPlugin: true, script: () => () => ({ kind: 'text', text: 'ok' }) },
        { prompt: () => 'b', script: () => () => ({ kind: 'text', text: 'ok' }) },
      ],
    }]
    await runKit({ claude: { cmd: process.execPath, args: [shim] }, plugin: dir, expect: 'clean', scenarios, timeoutMs: 20_000 })
    const lines = fs.readFileSync(seen, 'utf8').trim().split('\n').map(l => JSON.parse(l) as string[])
    assert.equal(lines.length, 2)
    assert.ok(!lines[0]?.includes('--plugin-dir'))
    assert.ok(lines[1]?.includes('--plugin-dir'))
    assert.ok(lines[1]?.includes(dir))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the disk search reports where fakes landed in the config dir, by label, and does not fail the run', async () => {
  const r = await runKit(base('write-config', 'leaks'))
  assert.equal(r.verdict, 'pass')
  assert.ok(r.disk.length > 0)
  assert.equal(r.disk[0]?.where, 'projects/*.jsonl')
  assert.ok((r.disk[0]?.fakes ?? 0) > 0)
})

test('ambient ANTHROPIC_* and CLAUDE_* never reach claude, except what the kit sets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-env-'))
  const file = path.join(dir, 'env.json')
  const keep = process.env.ANTHROPIC_AUTH_TOKEN
  process.env.ANTHROPIC_AUTH_TOKEN = 'ambient-value'
  process.env.CLAUDE_CODE_PLUGIN_DIRS = 'ambient-value'
  try {
    await runKit(base('show-env', 'leaks', { extraEnv: { STAND_IN_ENV_FILE: file } }))
    // The Git Bash path is a machine setting Claude Code needs on some Windows setups; the kit keeps it.
    const names = (JSON.parse(fs.readFileSync(file, 'utf8')) as string[]).filter(n => n !== 'CLAUDE_CODE_GIT_BASH_PATH')
    assert.deepEqual(names, [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
      'CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL',
      'CLAUDE_CONFIG_DIR',
    ])
  } finally {
    if (keep === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = keep
    delete process.env.CLAUDE_CODE_PLUGIN_DIRS
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the version check gets the same clean environment as a run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-version-env-'))
  const seen = path.join(dir, 'names.json')
  const shim = path.join(dir, 'shim.mjs')
  fs.writeFileSync(shim, `import fs from 'node:fs'
if (process.argv.includes('--version')) {
  fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify(Object.keys(process.env)))
  console.log('2.1.316 (Claude Code)')
}
`)
  process.env.ANTHROPIC_AUTH_TOKEN_PROBE = 'ambient-value'
  try {
    await runKit({ claude: { cmd: process.execPath, args: [shim] }, plugin: null, expect: 'clean', scenarios: [], timeoutMs: 20_000 })
    const names = JSON.parse(fs.readFileSync(seen, 'utf8')) as string[]
    assert.ok(!names.includes('ANTHROPIC_AUTH_TOKEN_PROBE'))
  } finally {
    delete process.env.ANTHROPIC_AUTH_TOKEN_PROBE
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a leak names the path it went to', async () => {
  const r = await runKit(base('send-all', 'leaks'))
  assert.deepEqual(r.doors[0]?.fakes[0]?.paths, ['/v1/messages'])
})

test('scratch folders are removed, and kept only when asked', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-scratch-'))
  try {
    await runKit(base('send-all', 'leaks', { scratch }))
    assert.deepEqual(fs.readdirSync(scratch), [])
    await runKit(base('send-all', 'leaks', { scratch, keep: true }))
    assert.ok(fs.readdirSync(scratch).length > 0)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})

test('failure: a missing binary gives a clear error', async () => {
  await assert.rejects(runKit({ ...base('send-all', 'leaks'), claude: { cmd: path.join(os.tmpdir(), 'no-such-claude-binary') } }), (e: unknown) => {
    assert.ok(e instanceof KitError)
    assert.match(e.message, /could not start/)
    return true
  })
})

test('failure: a .cmd shim gives a clear error on Windows', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-shim-'))
  try {
    const shim = path.join(dir, 'claude.cmd')
    fs.writeFileSync(shim, '@echo off\r\n')
    await assert.rejects(runKit({ ...base('send-all', 'leaks'), claude: { cmd: shim } }), /real binary/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('failure: a version that fails to answer gives a clear error', async () => {
  await assert.rejects(runKit(base('version-fails', 'leaks')), /version/)
})

test('requirePinned refuses another version; otherwise the version is only reported', async () => {
  await assert.rejects(runKit(base('old-version', 'leaks', { pinned: '2.1.316', requirePinned: true })), /2\.1\.316/)
  const r = await runKit(base('old-version', 'leaks', { pinned: '2.1.316' }))
  assert.equal(r.claudeVersion, '1.0.0')
  assert.equal(r.pinnedVersion, '2.1.316')
  assert.equal(r.verdict, 'pass')
})

test('a fake that a failing claude prints never reaches the report', async () => {
  const r = await runKit(base('print-fakes', 'leaks'))
  const needlesProbe = /ghp_[0-9a-zA-Z]{36}|AKIA[A-Z2-7]{16}|BEGIN RSA|password=[A-Z]/
  assert.doesNotMatch(JSON.stringify(r), needlesProbe)
  assert.equal(r.verdict, 'invalid')
})

function cli(...args: string[]) {
  return spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8', timeout: 120_000 })
}

test('CLI: prints labels and a verdict, exits 0, and never prints a fake', () => {
  const r = cli('--expect', 'leaks', '--claude', process.execPath, '--claude-arg', STAND_IN, '--claude-arg', 'send-all', '--only', 'prompt-typed', '--no-plugin')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /PASS/)
  assert.match(r.stdout, /prompt-typed/)
  assert.doesNotMatch(r.stdout + r.stderr, /ghp_[0-9a-zA-Z]{36}|AKIA[A-Z2-7]{16}|BEGIN RSA|password=[A-Z]/)
})

test('CLI: a leak in clean mode exits 1', () => {
  const r = cli('--expect', 'clean', '--claude', process.execPath, '--claude-arg', STAND_IN, '--claude-arg', 'send-all', '--only', 'prompt-typed', '--no-plugin')
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /LEAK/)
})

test('CLI: writes a JSON report that holds no fake', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-report-'))
  const file = path.join(dir, 'report.json')
  try {
    const r = cli('--expect', 'leaks', '--claude', process.execPath, '--claude-arg', STAND_IN, '--claude-arg', 'send-all', '--only', 'prompt-typed', '--no-plugin', '--report', file)
    assert.equal(r.status, 0, r.stderr)
    const text = fs.readFileSync(file, 'utf8')
    assert.equal((JSON.parse(text) as Report).verdict, 'pass')
    assert.doesNotMatch(text, /ghp_[0-9a-zA-Z]{36}|AKIA[A-Z2-7]{16}|BEGIN RSA|password=[A-Z]/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI: bad flags and an unknown scenario exit 2 with usage', () => {
  assert.equal(cli('--expect', 'maybe').status, 2)
  const r = cli('--only', 'no-such-door', '--claude', process.execPath, '--claude-arg', STAND_IN, '--no-plugin')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /unknown scenario/)
})

test('claude binary: an explicit path wins; no pin falls back to PATH', () => {
  assert.equal(resolveClaude({ explicit: '/x/claude', pinDir: path.join(os.tmpdir(), 'no-pin-here') }).cmd, '/x/claude')
  assert.equal(resolveClaude({ pinDir: path.join(os.tmpdir(), 'no-pin-here') }).cmd, 'claude')
})

test('claude binary: the pinned platform binary is used when installed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-pin-'))
  try {
    const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
    const pkg = path.join(dir, 'node_modules', '@anthropic-ai', `claude-code-${process.platform}-${process.arch}`)
    fs.mkdirSync(pkg, { recursive: true })
    fs.writeFileSync(path.join(pkg, exe), '')
    assert.equal(resolveClaude({ pinDir: dir }).cmd, path.join(pkg, exe))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
