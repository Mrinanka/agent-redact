// A real managed settings file, read by the plugin (plan step 5, closes two Known issues): the `aegisContext` key
// of a file the machine's policy holds reaches the plugin as the `policy` source, and `/redact doctor` calls the
// install Managed. The file applies to every Claude Code session on the machine while it exists, so this test
// runs only when AEGISCONTEXT_MANAGED_REAL=1 (CI sets it) and removes the file in `finally`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveClaude } from '../tools/leak-test/claude-bin.ts'
import { managedFile } from '../tools/leak-test/managed-file.ts'
import { startLeakMock } from '../tools/leak-test/server.ts'

const root = path.join(import.meta.dirname, '..')
const claude = resolveClaude().cmd
const skip = process.env.AEGISCONTEXT_MANAGED_REAL !== '1' ? 'set AEGISCONTEXT_MANAGED_REAL=1 to write the machine\'s managed settings file' : claude === 'claude' ? 'the pinned Claude Code is not installed' : false

test('the plugin reads a aegisContext key from a real managed file, and doctor says Managed', { skip, timeout: 120_000 }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-managed-'))
  const work = path.join(base, 'work')
  const config = path.join(base, 'config')
  fs.mkdirSync(work)
  fs.mkdirSync(config)
  const file = managedFile({ aegisContext: { notices: 'off', locked: ['notices'] } })
  const mock = await startLeakMock({ script: () => ({ kind: 'text', text: 'ok' }) })
  const keep = ['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'OS']
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => keep.includes(k.toUpperCase())))
  let out = ''
  try {
    file.install()
    await new Promise<number | null>((resolve, reject) => {
      const child = spawn(claude, ['-p', '/redact doctor', '--plugin-dir', path.join(root, 'plugin')], {
        cwd: work,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...env, ANTHROPIC_BASE_URL: `http://${mock.host}:${mock.port}`, ANTHROPIC_API_KEY: 'mock-not-a-key', CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', DISABLE_AUTOUPDATER: '1' },
      })
      child.stdout?.on('data', c => { out += c })
      child.stderr?.on('data', c => { out += c })
      child.on('error', reject)
      child.on('close', resolve)
    })
  } finally {
    file.remove()
    await mock.close()
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  assert.match(out, /Install: Managed settings are present/)
  assert.match(out, /Settings: valid/)
})
