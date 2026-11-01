// The backup lock's hook settings against the pinned Claude Code with no `node` on the PATH (plan step 5,
// D-069): with `onFailure: "block"` (the Managed snippet) a hook that cannot start stops the prompt; without it
// (the Personal snippet) the prompt goes through. This is why the doctor warns about a missing onFailure.
// No key, no network, like the leak kit. Skips, saying why, where the pinned Claude Code isn't installed.

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveClaude } from '../tools/leak-test/claude-bin.ts'
import { needlesFor } from '../tools/leak-test/detect.ts'
import { startLeakMock } from '../tools/leak-test/server.ts'
import { backupSnippet } from '../src/core/snippet.ts'
import { makeFake, seededSource } from '../tools/test-sets/fakes.ts'

const root = path.join(import.meta.dirname, '..')
const claude = resolveClaude().cmd
const skip = claude === 'claude' ? 'the pinned Claude Code is not installed' : false
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-claude-real-'))
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

const FAKE = makeFake('github-pat', seededSource('backup-claude-real')).value

async function run(name: string, managed: boolean): Promise<{ requests: number; fakeSeen: boolean; stdout: string }> {
  const dir = path.join(base, name)
  const work = path.join(dir, 'work')
  const config = path.join(dir, 'config')
  const empty = path.join(dir, 'empty-path')
  for (const d of [work, config, empty]) fs.mkdirSync(d, { recursive: true })
  const main = path.join(root, 'plugin', 'backup', 'backup', 'main.js')
  fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify(backupSnippet({ main, managed })))
  const mock = await startLeakMock({ script: () => ({ kind: 'text', text: 'ok' }), needles: needlesFor('fake', FAKE) })
  const keep = ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => keep.includes(k.toUpperCase())))
  let stdout = ''
  await new Promise<number | null>((resolve, reject) => {
    const child = spawn(claude, ['-p', `My notes: ${FAKE}. Please reply.`], {
      cwd: work,
      stdio: ['ignore', 'pipe', 'ignore'],
      // A PATH that holds no program: `node` cannot be found, and the hook cannot start.
      env: { ...env, PATH: empty, ANTHROPIC_BASE_URL: `http://${mock.host}:${mock.port}`, ANTHROPIC_API_KEY: 'mock-not-a-key', CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', DISABLE_AUTOUPDATER: '1' },
    })
    child.stdout?.on('data', c => { stdout += c })
    child.on('error', reject)
    child.on('close', resolve)
  })
  await mock.close()
  const sent = mock.records.filter(r => r.path.startsWith('/v1/messages'))
  return { requests: sent.length, fakeSeen: sent.some(r => r.hits.length > 0), stdout }
}

test('no node on the PATH, with onFailure block: the prompt is stopped and nothing is sent', { skip, timeout: 120_000 }, async () => {
  const r = await run('managed', true)
  assert.equal(r.requests, 0, 'the prompt should not have been sent')
  assert.ok(!r.stdout.includes('ok\n'))
})

test('no node on the PATH, without onFailure: the hook fails, the prompt goes through, and the fake is seen', { skip, timeout: 120_000 }, async () => {
  const r = await run('personal', false)
  assert.ok(r.requests > 0, 'the run sent no request, so it proves nothing')
  assert.equal(r.fakeSeen, true)
})
