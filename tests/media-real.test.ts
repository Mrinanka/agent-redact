// Images through a real session (spec §6): the pinned Claude Code, the real plugin and the mock, for an
// image read from disk and one sent with the prompt. No key and no network, like the leak kit. Skips,
// saying why, where the pinned Claude Code isn't installed.

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveClaude } from '../tools/leak-test/claude-bin.ts'
import { startLeakMock, type ParsedRequest, type Reply } from '../tools/leak-test/server.ts'

const root = path.join(import.meta.dirname, '..')
const claude = resolveClaude().cmd
const skip = claude === 'claude' ? 'the pinned Claude Code is not installed' : false
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'media-real-'))
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

// A 1x1 PNG, built from bytes.
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

type Run = { sawImage: boolean; sawNote: boolean; requests: number }

async function run(name: string, media: 'pass' | 'drop', how: 'read' | 'pasted'): Promise<Run> {
  const dir = path.join(base, name)
  const work = path.join(dir, 'work')
  const config = path.join(dir, 'config')
  fs.mkdirSync(work, { recursive: true })
  fs.mkdirSync(config)
  fs.writeFileSync(path.join(work, 'photo.png'), PNG)
  fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ aegisContext: { media } }))
  let sawImage = false
  let sawNote = false
  let requests = 0
  const script = (r: ParsedRequest): Reply => {
    const body = JSON.stringify(r.messages)
    if (!r.hasTools) return { kind: 'text', text: 'ok' }
    requests++
    if (/"type":"image"/.test(body)) sawImage = true
    if (body.includes('aegiscontext removed an image')) sawNote = true
    const turns = r.messages.filter(m => m.role === 'assistant').length
    return how === 'read' && turns === 0 ? { kind: 'tool', name: 'Read', input: { file_path: path.join(work, 'photo.png') } } : { kind: 'text', text: 'done' }
  }
  const mock = await startLeakMock({ script })
  const prompt = { type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } }, { type: 'text', text: 'Look at this.' }] } }
  const args = how === 'read'
    ? ['-p', 'Read photo.png.', '--plugin-dir', path.join(root, 'plugin'), '--allowedTools', 'Read']
    : ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--plugin-dir', path.join(root, 'plugin')]
  const keep = ['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'OS']
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => keep.includes(k.toUpperCase())))
  const exit = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(claude, args, {
      cwd: work,
      stdio: [how === 'read' ? 'ignore' : 'pipe', 'ignore', 'inherit'],
      env: { ...env, ANTHROPIC_BASE_URL: `http://${mock.host}:${mock.port}`, ANTHROPIC_API_KEY: 'mock-not-a-key', CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', DISABLE_AUTOUPDATER: '1' },
    })
    child.stdin?.end(`${JSON.stringify(prompt)}\n`)
    child.on('error', reject)
    child.on('close', resolve)
  })
  await mock.close()
  assert.equal(exit, 0)
  assert.ok(requests > 0, 'the run sent no request, so it proves nothing')
  return { sawImage, sawNote, requests }
}

test('media pass: an image read from disk reaches the model', { skip, timeout: 120_000 }, async () => {
  const r = await run('read-pass', 'pass', 'read')
  assert.equal(r.sawImage, true)
  assert.equal(r.sawNote, false)
})

test('media drop: an image read from disk never reaches the model, and Claude is told', { skip, timeout: 120_000 }, async () => {
  const r = await run('read-drop', 'drop', 'read')
  assert.equal(r.sawImage, false)
  assert.equal(r.sawNote, true)
})

test('media pass: an image sent with the prompt reaches the model', { skip, timeout: 120_000 }, async () => {
  const r = await run('pasted-pass', 'pass', 'pasted')
  assert.equal(r.sawImage, true)
})

test('media drop: an image sent with the prompt never reaches the model, and Claude is told', { skip, timeout: 120_000 }, async () => {
  const r = await run('pasted-drop', 'drop', 'pasted')
  assert.equal(r.sawImage, false)
  assert.equal(r.sawNote, true)
})
