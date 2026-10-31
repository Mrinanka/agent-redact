// Step 0 driver: runs a scenario from scenarios.ts with `claude -p` against
// the local mock, the probe loaded, in a fresh scratch folder with its own
// CLAUDE_CONFIG_DIR (your own ~/.claude is never used). Prints a summary of
// labels, counts and true/false flags. Canary values never reach the summary:
// any text that is printed has them replaced by <canary:label>.
//
//   node experiments/step0-mock/run.ts <scenario|all> [more scenarios]
//
// Scratch folders go under $STEP0_SCRATCH, or the OS temp folder.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { startMock, type RequestRecord } from './server.ts'
import { SCENARIOS, WATCH_WORDS, type Ctx, type Scenario } from './scenarios.ts'

const REPO = path.join(import.meta.dirname, '..', '..')
const PROBE = path.join(REPO, 'experiments', 'step0-probe')
const HOOK = path.join(REPO, 'experiments', 'step0-settings-hooks', 'hook.mjs')
const RUN_TIMEOUT_MS = 240_000

const newCanary = () => ['CANARY', randomBytes(8).toString('hex')].join('-')

function sanitizer(ctx: Ctx): (s: string) => string {
  return s => Object.entries(ctx.canary).reduce((acc, [label, value]) => acc.split(value).join(`<canary:${label}>`), s)
}

function hookSettings(): Record<string, unknown> {
  const hook = { type: 'command', command: `node "${HOOK}"`, timeout: 30 }
  return {
    hooks: {
      SessionStart: [{ hooks: [hook] }],
      UserPromptSubmit: [{ hooks: [hook] }],
      PreToolUse: [{ matcher: '*', hooks: [hook] }],
      PostToolUse: [{ matcher: '*', hooks: [hook] }],
    },
  }
}

type Labelled = { labels: string[]; words: string[] }

function flags(r: RequestRecord, labels: string[]): Labelled {
  const out: Labelled = { labels: [], words: [] }
  labels.forEach((label, i) => {
    if (r.canaries[`c${i}`]) out.labels.push(label)
  })
  WATCH_WORDS.forEach((w, j) => {
    if (r.canaries[`c${labels.length + j}`]) out.words.push(w)
  })
  return out
}

function describeRequest(r: RequestRecord, labels: string[]) {
  const last = r.msgs.at(-1)
  const f = flags(r, labels)
  return {
    i: r.i,
    main: r.nTools > 0,
    nMsgs: r.msgs.length,
    hasAgentTool: r.tools.includes('Agent') || r.tools.includes('Task'),
    last: last ? `${last.role}[${last.blocks.map(b => b.type + (b.isError ? '!' : '') + (b.mediaType ? `(${b.mediaType})` : '') + (b.parts ? `{${b.parts.join('+')}}` : '') + (b.chars !== undefined ? `:${b.chars}` : '')).join(',')}]` : '',
    mediaBlocks: r.msgs.flatMap(m => m.blocks).filter(b => b.type === 'image' || b.type === 'document').length,
    canaries: f.labels,
    words: f.words,
    reply: r.reply,
  }
}

function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l) as Record<string, unknown>)
}

function describeRow(l: Record<string, unknown>): string {
  const blocks = (l.blocks as Record<string, unknown>[] | undefined ?? []).map(b => String(b.type) + (b.isError ? '!' : '')).join(',')
  const origin = l.origin as Record<string, string> | undefined
  return [
    String(l.door),
    `${l.type}${l.name ? `/${l.name}` : ''}`,
    l.role ? String(l.role) : '-',
    origin ? Object.values(origin).join(':') : '',
    l.agentId ? 'agent' : '',
    `[${blocks}]`,
  ].filter(s => s !== '').join(' ')
}

function runClaude(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{ code: number | null; ms: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise(resolve => {
    const t0 = Date.now()
    const child = spawn('claude', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', c => { stdout += c })
    child.stderr.on('data', c => { stderr += c })
    const timer = setTimeout(() => { timedOut = true; child.kill() }, RUN_TIMEOUT_MS)
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, ms: Date.now() - t0, stdout, stderr, timedOut })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: null, ms: Date.now() - t0, stdout, stderr: 'spawn failed', timedOut })
    })
  })
}

async function runScenario(s: Scenario): Promise<Record<string, unknown>> {
  const base = fs.mkdtempSync(path.join(process.env.STEP0_SCRATCH ?? os.tmpdir(), `step0-${s.name}-`))
  const work = path.join(base, 'work')
  const config = path.join(base, 'config')
  const probeDir = path.join(work, '.step0-probe')
  fs.mkdirSync(probeDir, { recursive: true })
  fs.mkdirSync(config, { recursive: true })
  const ctx: Ctx = { dir: work, canary: Object.fromEntries(s.canaries.map(l => [l, newCanary()])) }
  const clean = sanitizer(ctx)
  const labels = Object.keys(ctx.canary)
  const watched = [...Object.values(ctx.canary), ...WATCH_WORDS]

  for (const [name, content] of Object.entries(s.files?.(ctx) ?? {})) fs.writeFileSync(path.join(work, name), content)
  if (s.settingsHooks) fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify(hookSettings(), null, 2))
  if (s.projectSettings || s.localSettings) fs.mkdirSync(path.join(work, '.claude'), { recursive: true })
  if (s.projectSettings) fs.writeFileSync(path.join(work, '.claude', 'settings.json'), JSON.stringify(s.projectSettings))
  if (s.localSettings) fs.writeFileSync(path.join(work, '.claude', 'settings.local.json'), JSON.stringify(s.localSettings))

  const sessionId = randomUUID()
  const runs: Record<string, unknown>[] = []
  for (const [i, run] of s.runs.entries()) {
    for (const f of fs.readdirSync(probeDir)) if (/^(on|hook)-/.test(f)) fs.rmSync(path.join(probeDir, f))
    for (const m of run.markers ?? []) fs.writeFileSync(path.join(probeDir, m), '')
    const mock = await startMock({ script: run.script(ctx), canaries: watched })
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://${mock.host}:${mock.port}`,
      ANTHROPIC_API_KEY: 'mock-not-a-key',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CONFIG_DIR: config,
      ...run.env,
    }
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.CLAUDE_CODE_PLUGIN_DIRS
    const args = [
      '-p', run.prompt(ctx),
      ...(s.probe === false ? [] : ['--plugin-dir', PROBE]),
      ...(run.resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
      ...(run.args ?? []),
    ]
    const r = await runClaude(args, env, work)
    const records = [...mock.records]
    await mock.close()
    runs.push({
      run: i,
      markers: run.markers ?? [],
      exit: r.code,
      timedOut: r.timedOut,
      seconds: Math.round(r.ms / 100) / 10,
      stdoutChars: r.stdout.length,
      stdoutCanaries: labels.filter(l => r.stdout.includes(ctx.canary[l] ?? '\0')),
      stderr: clean(r.stderr).split(/\r?\n/).filter(l => l.trim() !== '').slice(0, 6).map(l => l.slice(0, 240)),
      requests: records.map(rec => describeRequest(rec, labels)),
    })
  }

  const probeLines = fs.readdirSync(probeDir).filter(f => /\.jsonl$/.test(f) && f !== 'settings-hook.jsonl')
    .flatMap(f => readJsonl(path.join(probeDir, f)))
  const doors: Record<string, number> = {}
  for (const l of probeLines) if (l.kind === 'row') doors[String(l.door)] = (doors[String(l.door)] ?? 0) + 1
  const copies = fs.readdirSync(probeDir).filter(f => f.startsWith('mention-copy-'))
  const summary = {
    scenario: s.name,
    checks: s.checks,
    dir: base,
    runs,
    probe: {
      starts: probeLines.filter(l => l.kind === 'start').map(l => ({ engine: l.engine, surface: l.surface, interactive: l.interactive })),
      doors,
      rows: probeLines.filter(l => l.kind === 'row').map(describeRow),
      checks: probeLines.filter(l => l.kind === 'check'),
      mentionCopiesHoldCanary: copies.some(f => Object.values(ctx.canary).some(c => fs.readFileSync(path.join(probeDir, f), 'utf8').includes(c))),
    },
    settingsHook: readJsonl(path.join(probeDir, 'settings-hook.jsonl')),
  }
  // The summary itself must never hold a canary.
  const json = JSON.stringify(summary, null, 2)
  if (Object.values(ctx.canary).some(c => json.includes(c))) throw new Error('step0 driver: a canary reached the summary; not printed')
  fs.writeFileSync(path.join(base, 'summary.json'), json)
  return summary
}

const wanted = process.argv.slice(2)
if (wanted.length === 0) {
  console.error(`usage: node run.ts <scenario|all> ...\nscenarios: ${SCENARIOS.map(s => s.name).join(', ')}`)
  process.exit(2)
}
const chosen = wanted.includes('all') ? SCENARIOS : SCENARIOS.filter(s => wanted.includes(s.name))
const unknown = wanted.filter(w => w !== 'all' && !SCENARIOS.some(s => s.name === w))
if (unknown.length > 0) {
  console.error(`unknown scenario: ${unknown.join(', ')}`)
  process.exit(2)
}
for (const s of chosen) {
  const summary = await runScenario(s)
  console.log(JSON.stringify(summary, null, 2))
}
