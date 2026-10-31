// Tests for the Step 0 settings-hook script (experiments/step0-settings-hooks/hook.mjs),
// used for checks 0.8, 0.9, 0.13 and 0.14. It logs metadata only, and acts
// only when a marker file in <cwd>/.step0-probe/ asks it to.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const HOOK = path.join(import.meta.dirname, '..', 'experiments', 'step0-settings-hooks', 'hook.mjs')

const canary = () => ['CANARY', randomBytes(8).toString('hex')].join('-')

function scratch(markers: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'step0-hook-'))
  fs.mkdirSync(path.join(dir, '.step0-probe'))
  for (const m of markers) fs.writeFileSync(path.join(dir, '.step0-probe', m), '')
  return dir
}

function run(dir: string, input: Record<string, unknown>, raw?: string) {
  const r = spawnSync(process.execPath, [HOOK], { input: raw ?? JSON.stringify({ cwd: dir, session_id: 's-1', ...input }), encoding: 'utf8', timeout: 20_000 })
  const logFile = path.join(dir, '.step0-probe', 'settings-hook.jsonl')
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
  const lines = log.split('\n').filter(l => l !== '').map(l => JSON.parse(l) as Record<string, unknown>)
  const out = r.stdout.trim() === '' ? undefined : JSON.parse(r.stdout) as Record<string, any>
  return { status: r.status, out, log, lines }
}

test('logs the event, tool and sizes, never content; answers nothing without a marker', () => {
  const dir = scratch()
  const c = canary()
  try {
    const r = run(dir, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'a.txt' }, tool_response: { file: { content: `x ${c}\r\ny ✓` } } })
    assert.equal(r.status, 0)
    assert.equal(r.out, undefined)
    assert.ok(!r.log.includes(c))
    assert.deepEqual(r.lines, [{
      kind: 'settings-hook', event: 'PostToolUse', tool: 'Read', node: process.version,
      inputChars: JSON.stringify({ file_path: 'a.txt' }).length,
      responseChars: JSON.stringify({ file: { content: `x ${c}\r\ny ✓` } }).length,
      hasCanary: true, safeMode: false, acted: 'none', t: r.lines[0]?.t,
    }])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('0.9: with hook-pre-rewrite, a Bash PreToolUse gets updatedInput with a marker command', () => {
  const dir = scratch(['hook-pre-rewrite'])
  try {
    const r = run(dir, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat notes.txt', description: 'd' } })
    assert.deepEqual(r.out, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: 'echo PRE-REWRITTEN', description: 'd' } } })
    assert.equal(r.lines[0]?.acted, 'pre-rewrite')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('0.9: with hook-post-rewrite, PostToolUse answers updatedToolOutput with a marker', () => {
  const dir = scratch(['hook-post-rewrite'])
  try {
    const r = run(dir, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {}, tool_response: 'x' })
    assert.deepEqual(r.out, { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: 'POST-REWRITTEN' } })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('0.9: with hook-post-scrub, PostToolUse answers the tool response in its own shape, canaries replaced', () => {
  const dir = scratch(['hook-post-scrub'])
  const c = canary()
  try {
    const response = { stdout: `a ${c}\r\nb`, stderr: '', interrupted: false, isImage: false, nested: { list: [`x ${c}`, 3, null] } }
    const r = run(dir, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {}, tool_response: response })
    assert.deepEqual(r.out, { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: {
      stdout: 'a POST-SCRUBBED\r\nb', stderr: '', interrupted: false, isImage: false, nested: { list: ['x POST-SCRUBBED', 3, null] },
    } } })
    assert.equal(r.lines[0]?.acted, 'post-scrub')
    assert.ok(!r.log.includes(c))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('0.9: with hook-prompt-suppress, UserPromptSubmit suppresses the prompt and adds a marker context', () => {
  const dir = scratch(['hook-prompt-suppress'])
  const c = canary()
  try {
    const r = run(dir, { hook_event_name: 'UserPromptSubmit', prompt: `here ${c}` })
    assert.deepEqual(r.out, { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true, additionalContext: 'PROMPT-REPLACED' } })
    assert.ok(!r.log.includes(c))
    assert.equal(r.lines[0]?.promptChars, `here ${c}`.length)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('with hook-prompt-block, UserPromptSubmit blocks the prompt', () => {
  const dir = scratch(['hook-prompt-block'])
  try {
    const r = run(dir, { hook_event_name: 'UserPromptSubmit', prompt: 'x' })
    assert.deepEqual(r.out, { decision: 'block', reason: 'step0 settings hook blocked this prompt' })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('failure: bad JSON on stdin exits 0 with no answer and logs a parse error, never the input', () => {
  const dir = scratch()
  const c = canary()
  try {
    const r = run(dir, {}, `{"cwd": "${dir.replace(/\\/g, '\\\\')}", "oops": "${c}"`)
    assert.equal(r.status, 0)
    assert.equal(r.out, undefined)
    assert.ok(!r.log.includes(c))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a --source argument is logged as a label (managed vs user hooks), and an odd one as (odd)', () => {
  const dir = scratch()
  try {
    const managed = spawnSync(process.execPath, [HOOK, '--source', 'managed'], { input: JSON.stringify({ cwd: dir, hook_event_name: 'SessionStart' }), encoding: 'utf8' })
    const odd = spawnSync(process.execPath, [HOOK, '--source', 'bad value!'], { input: JSON.stringify({ cwd: dir, hook_event_name: 'SessionStart' }), encoding: 'utf8' })
    const none = run(dir, { hook_event_name: 'SessionStart' })
    assert.equal(managed.status, 0)
    assert.equal(odd.status, 0)
    assert.deepEqual(none.lines.map(l => l.source), ['managed', '(odd)', undefined])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('failure: a cwd with no .step0-probe folder writes nothing and still exits 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'step0-hook-none-'))
  try {
    const r = run(dir, { hook_event_name: 'SessionStart' })
    assert.equal(r.status, 0)
    assert.equal(fs.existsSync(path.join(dir, '.step0-probe')), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
