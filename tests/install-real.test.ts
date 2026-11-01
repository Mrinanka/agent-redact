// A real install of the plugin from a folder marketplace (plan step 6): the pinned Claude Code, a marketplace
// folder whose path holds a space, `plugin marketplace add`, `plugin install`, a session against the mock that
// must show the plugin in the user tier and a fake hidden, then `plugin uninstall`, after which the same prompt
// must show the fake (so the hiding was the plugin's). No key and no network. Skips, saying why, where the
// pinned Claude Code isn't installed. The install from GitHub, as the README says, runs in CI (release job).

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveClaude } from '../tools/leak-test/claude-bin.ts'
import { needlesFor, witnessNeedle } from '../tools/leak-test/detect.ts'
import { buildMarketplaceFolder } from '../tools/leak-test/org.ts'
import { startLeakMock } from '../tools/leak-test/server.ts'
import { makeFake, makeWitness, plant, randomSource } from '../tools/test-sets/fakes.ts'

const root = path.join(import.meta.dirname, '..')
const claude = resolveClaude().cmd
const skip = claude === 'claude' ? 'the pinned Claude Code is not installed' : false
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'install real-'))
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

const KEEP = ['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'OS', 'PSMODULEPATH', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR']
const baseEnv = (config: string): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => KEEP.includes(k.toUpperCase()))),
  CLAUDE_CONFIG_DIR: config,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
  DISABLE_AUTOUPDATER: '1',
})

const cli = (config: string, ...args: string[]) => spawnSync(claude, args, { env: baseEnv(config), encoding: 'utf8', timeout: 90_000 })

/** One `claude -p` run; returns what the mock saw of the planted fake and witness, and checks the debug file exists. */
async function session(config: string, work: string, debugFile: string): Promise<{ fakeSeen: boolean; witnessSeen: boolean; exit: number | null }> {
  const src = randomSource()
  const fake = makeFake('github-pat', src)
  const witness = makeWitness(src)
  const needles = [witnessNeedle('witness', witness), ...needlesFor('fake', fake.value)]
  const mock = await startLeakMock({ script: () => ({ kind: 'text' as const, text: 'ok' }), needles })
  const prompt = `My notes:\n${witness}\n${plant(fake, 'plain')}\nPlease reply.`
  const exit = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(claude, ['-p', prompt, '--debug-file', debugFile], {
      cwd: work,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...baseEnv(config), ANTHROPIC_BASE_URL: `http://${mock.host}:${mock.port}`, ANTHROPIC_API_KEY: 'mock-not-a-key' },
    })
    child.on('error', reject)
    child.on('close', resolve)
  })
  await mock.close()
  const hits = mock.records.flatMap(r => r.hits.map(h => h.fakeId))
  return { fakeSeen: hits.includes('fake'), witnessSeen: hits.includes('witness'), exit }
}

test('a real install from a folder marketplace (path with a space) hides a fake in the user tier, and uninstall ends it', { skip, timeout: 300_000 }, async () => {
  const market = path.join(base, 'market place')
  const config = path.join(base, 'config')
  const work = path.join(base, 'work')
  fs.mkdirSync(config)
  fs.mkdirSync(work)
  buildMarketplaceFolder(market, root)

  const added = cli(config, 'plugin', 'marketplace', 'add', market)
  assert.equal(added.status, 0, `marketplace add: ${added.stdout}${added.stderr}`)
  const installed = cli(config, 'plugin', 'install', 'aegiscontext@aegiscontext')
  assert.equal(installed.status, 0, `install: ${installed.stdout}${installed.stderr}`)
  assert.match(cli(config, 'plugin', 'list').stdout, /aegiscontext@aegiscontext[\s\S]*enabled/)

  const withTool = await session(config, work, path.join(base, 'with.log'))
  assert.equal(withTool.exit, 0)
  assert.ok(withTool.witnessSeen, 'the witness was not seen, so the run proves nothing')
  assert.equal(withTool.fakeSeen, false, 'the installed plugin let the fake through')
  assert.match(fs.readFileSync(path.join(base, 'with.log'), 'utf8'), /hooks module aegiscontext@aegiscontext loaded \([^)]*tier user\)/)

  const removed = cli(config, 'plugin', 'uninstall', 'aegiscontext@aegiscontext')
  assert.equal(removed.status, 0, `uninstall: ${removed.stdout}${removed.stderr}`)
  const without = await session(config, work, path.join(base, 'without.log'))
  assert.ok(without.witnessSeen)
  assert.equal(without.fakeSeen, true, 'after uninstall the fake must reach the model: nothing is hiding it')
})
