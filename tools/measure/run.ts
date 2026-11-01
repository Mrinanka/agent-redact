// npm run measure: prints the numbers step 2 is judged by.
//   1. rules: converted and rejected, with reasons
//   2. catch rate by context and by format (decoder-dependent cases shown apart)
//   3. the code set (R-08)
//   4. false alarms per MB, by rule
//   5. speed per item, under Node
//   6. the same through the whole pipeline: matcher, checker and decoder (step 3)
//   7. false alarms on log-like text, by rule (step 5)
// Exits 1 if an automated "done when" fails, so CI notices. Prints labels and
// counts only, never a value.

import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { TARGETS } from './targets.ts'
import { createChecker } from '../../src/checker/index.ts'
import { NO_ALLOW, Redactor } from '../../src/core/session.ts'
import type { SecretEntry } from '../../src/core/store.ts'
import { REJECTIONS, RULES, BUILD_WARNINGS, GITLEAKS_VERSION } from '../../src/checker/rules.generated.ts'
import { catchSet, type CatchCase } from '../test-sets/catch.ts'
import { codeSet } from '../test-sets/code.ts'
import { falseAlarmFiles } from '../test-sets/false-alarm.ts'
import { logFiles } from '../test-sets/logs.ts'
import { speedSet } from '../test-sets/speed.ts'

const root = path.join(import.meta.dirname, '..', '..')
const { checker, errors } = createChecker({ budgetMs: 60_000 })
let failed = false
const fail = (why: string): void => {
  failed = true
  console.log(`  FAIL: ${why}`)
}
const pct = (a: number, b: number): string => (b === 0 ? 'n/a' : `${((100 * a) / b).toFixed(1)}%`)
const ms = (n: number): string => `${n.toFixed(1)} ms`

// ---- 1. rules ------------------------------------------------------------------------

console.log(`\n== 1. Rules (Gitleaks ${GITLEAKS_VERSION}) ==`)
console.log(`converted ${RULES.length}, rejected ${REJECTIONS.length}, total ${RULES.length + REJECTIONS.length} (must be 222)`)
if (RULES.length + REJECTIONS.length !== 222) fail('rule count is not 222')
for (const r of REJECTIONS) console.log(`  rejected ${r.id}: ${r.reason}`)
for (const w of BUILD_WARNINGS) console.log(`  warning ${w}`)
if (errors.length > 0) fail(`checker errors: ${errors.map(e => e.id).join(', ')}`)
const notes: Record<string, number> = {}
for (const r of RULES) notes[r.keywordNote ?? '?'] = (notes[r.keywordNote ?? '?'] ?? 0) + 1
console.log(`keywords compared with Gitleaks': ${Object.entries(notes).map(([k, v]) => `${k} ${v}`).join(', ')}`)

// ---- 2. catch -------------------------------------------------------------------------

function covered(c: CatchCase): boolean {
  const s = c.secrets[0]
  if (!s) return false
  const r = checker.scan(c.text)
  checker.clearLines()
  for (let i = s.start; i < s.end; i++) if (!r.findings.some(f => f.start <= i && i < f.end)) return false
  return true
}

console.log('\n== 2. Catch rate ==')
const IN_SCOPE = ['env', 'env-crlf', 'json', 'yaml', 'log', 'log-unicode', 'stack-trace', 'escaped-json']
const byContext = new Map<string, [number, number]>()
const byFormat = new Map<string, [number, number]>()
const needsDecoder: string[] = []
const missed: string[] = []
for (const c of catchSet()) {
  const decoder = c.secrets.some(s => s.encoding === 'base64' || s.encoding === 'url')
  if (decoder) {
    needsDecoder.push(`${c.id}`)
    continue
  }
  const ok = covered(c)
  const a = byContext.get(c.context) ?? [0, 0]
  byContext.set(c.context, [a[0] + (ok ? 1 : 0), a[1] + 1])
  const b = byFormat.get(c.format) ?? [0, 0]
  byFormat.set(c.format, [b[0] + (ok ? 1 : 0), b[1] + 1])
  if (!ok) missed.push(c.id)
}
console.log('by context:')
for (const [k, [ok, n]] of byContext) console.log(`  ${k.padEnd(14)} ${ok}/${n} ${pct(ok, n)}`)
console.log('by format:')
for (const [k, [ok, n]] of byFormat) console.log(`  ${k.padEnd(18)} ${ok}/${n} ${pct(ok, n)}`)
console.log(`needs the decoder (step 3), not counted as misses: ${needsDecoder.length}`)
for (const ctx of IN_SCOPE) {
  const v = byContext.get(ctx)
  if (!v) fail(`no cases in context ${ctx}`)
  else if (v[0] !== v[1]) fail(`catch in ${ctx} is ${v[0]}/${v[1]}`)
}
if (missed.length > 0) console.log(`missed: ${missed.join(', ')}`)

// ---- 3. code set -------------------------------------------------------------------------

console.log('\n== 3. Code set (R-08) ==')
const real = ['Autumn' + '2026xk', 'Meadow' + '7731bq']
let left = 0
let twins = 0
const cs = codeSet()
for (const c of cs) {
  if (checker.scan(c.text).findings.length === 0) left++
  else fail(`${c.id}: harmless text was hidden`)
  checker.clearLines()
  const values = c.id === 'documented-example-key' ? ['AK' + 'IA' + 'ZQ7XKMN4HTW3PBDC'] : real
  for (const v of values) {
    const text = c.twin(v)
    const at = text.indexOf(v)
    const r = checker.scan(text)
    checker.clearLines()
    if (r.findings.some(f => f.start <= at && f.end >= at + v.length)) twins++
    else fail(`${c.id}: the twin was not hidden`)
  }
}
console.log(`left alone ${left}/${cs.length}; twins hidden ${twins}/${cs.reduce((n, c) => n + (c.id === 'documented-example-key' ? 1 : real.length), 0)}`)
if (twins !== TARGETS.twinsHidden) fail(`twins hidden ${twins}, target ${TARGETS.twinsHidden}`)

// ---- 4. false alarms ----------------------------------------------------------------------

console.log('\n== 4. False alarms per MB (the typescript and @types/node sources) ==')
const files = falseAlarmFiles(root)
for (const withFile of [true, false]) {
  const counts = new Map<string, number>()
  let bytes = 0
  for (const f of files) {
    const text = fs.readFileSync(f.file, 'utf8')
    bytes += Buffer.byteLength(text)
    const r = checker.scan(text, withFile ? { file: f.name } : {})
    checker.clearLines()
    for (const x of r.findings) counts.set(x.ruleId, (counts.get(x.ruleId) ?? 0) + 1)
  }
  const mb = bytes / (1024 * 1024)
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  console.log(`${withFile ? 'with the file name' : 'with no file name'}: ${files.length} files, ${mb.toFixed(1)} MB, ${total} hidden (${(total / mb).toFixed(2)} per MB)`)
  for (const [id, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${id.padEnd(28)} ${n} (${(n / mb).toFixed(2)} per MB)`)
}

// ---- 5. speed ------------------------------------------------------------------------------

console.log('\n== 5. Speed under Node (first scan, then a repeat) ==')
const textOnly = new Set(['registered-10k', 'base64-block-2m'])
for (const item of speedSet()) {
  const text = item.text()
  checker.clearLines()
  const t0 = performance.now()
  const r = checker.scan(text)
  const first = performance.now() - t0
  const t1 = performance.now()
  checker.scan(text)
  const again = performance.now() - t1
  checker.clearLines()
  const note = textOnly.has(item.id) ? '  (timed as plain text; the registered-secret and decoder work is step 3)' : ''
  console.log(`  ${item.id.padEnd(38)} ${(text.length / 1024).toFixed(0).padStart(6)} KB  first ${ms(first).padStart(10)}  repeat ${ms(again).padStart(10)}  hidden ${r.findings.length}  complete ${r.complete}${note}`)
  if (!r.complete) fail(`${item.id} ran out of budget`)
}

// ---- 6. the whole pipeline ------------------------------------------------------------------

console.log('\n== 6. The whole pipeline (matcher, checker, decoder) ==')
const BUDGET_MS = 4000
const redactor = (registered: SecretEntry[] = []): Redactor => new Redactor({ checker: createChecker({}).checker, registered, hints: true, allow: NO_ALLOW })
const deadline = (ms = 60_000): number => performance.now() + ms

// A bare value in base64 has no shape and no label, so nothing can catch it (spec §22, D-046).
const SHAPELESS = new Set(['jfrog/base64', 'connection-string/base64', 'labelled-password/base64'])
const cases = catchSet()
const missedAll = cases.filter(c => {
  const s = c.secrets[0]
  return s === undefined || redactor().redactText(c.text, { deadline: deadline() }).text.includes(s.shown)
})
console.log(`catch set: ${cases.length - missedAll.length}/${cases.length} ${pct(cases.length - missedAll.length, cases.length)}`)
if (missedAll.length > 0) console.log(`not caught: ${missedAll.map(c => c.id).join(', ')}`)
for (const c of missedAll) if (!SHAPELESS.has(c.id)) fail(`${c.id} was not caught`)
if (cases.length !== TARGETS.catchOf) fail(`the catch set has ${cases.length} cases, not ${TARGETS.catchOf}`)
if (cases.length - missedAll.length < TARGETS.catchAtLeast) fail(`catch ${cases.length - missedAll.length}/${cases.length} is below the target ${TARGETS.catchAtLeast}`)

let codeLeft = 0
for (const c of cs) if (redactor().redactText(c.text, { deadline: deadline() }).hits.length === 0) codeLeft++
console.log(`code set: left alone ${codeLeft}/${cs.length}`)
if (codeLeft !== cs.length) fail('the pipeline hid harmless code')
if (codeLeft !== TARGETS.codeLeftAlone) fail(`code set left alone ${codeLeft}, target ${TARGETS.codeLeftAlone}`)

for (const withFile of [true, false]) {
  let bytes = 0
  let hidden = 0
  for (const f of files) {
    const text = fs.readFileSync(f.file, 'utf8')
    bytes += Buffer.byteLength(text)
    hidden += redactor().redactText(text, { deadline: deadline(), ...(withFile ? { file: f.name } : {}) }).hits.length
  }
  const mb = bytes / (1024 * 1024)
  console.log(`false alarms ${withFile ? 'with the file name' : 'with no file name'}: ${hidden} hidden (${(hidden / mb).toFixed(2)} per MB)`)
  const limit = withFile ? TARGETS.falseAlarmsPerMb.sourceWithFile : TARGETS.falseAlarmsPerMb.sourceNoFile
  if (hidden / mb > limit) fail(`false alarms ${withFile ? 'with' : 'with no'} file name: ${(hidden / mb).toFixed(2)} per MB is over the target ${limit}`)
}

// ---- 7. log-like text ------------------------------------------------------------------------

console.log('\n== 7. False alarms per MB on log-like text (access, app and JSON logs, traces, git output, ids) ==')
const logs = logFiles()
{
  const counts = new Map<string, number>()
  let bytes = 0
  let hidden = 0
  let emails = 0
  let phones = 0
  for (const f of logs) {
    bytes += Buffer.byteLength(f.text)
    const r = checker.scan(f.text, { file: f.name })
    for (const x of r.findings) counts.set(x.ruleId, (counts.get(x.ruleId) ?? 0) + 1)
    hidden += redactor().redactText(f.text, { deadline: deadline(), file: f.name }).hits.length
    for (const x of createChecker({ personalData: true }).checker.scan(f.text, { file: f.name }).findings) {
      if (x.ruleId === 'personal-email') emails++
      if (x.ruleId === 'personal-phone') phones++
    }
  }
  const mb = bytes / (1024 * 1024)
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  console.log(`checker alone: ${logs.length} files, ${mb.toFixed(2)} MB, ${total} hidden (${(total / mb).toFixed(2)} per MB)`)
  for (const [id, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${id.padEnd(28)} ${n} (${(n / mb).toFixed(2)} per MB)`)
  console.log(`through the whole pipeline: ${hidden} hidden (${(hidden / mb).toFixed(2)} per MB)`)
  if (hidden / mb > TARGETS.falseAlarmsPerMb.logs) fail(`log false alarms ${(hidden / mb).toFixed(2)} per MB is over the target ${TARGETS.falseAlarmsPerMb.logs}`)
  // The set holds git author addresses (name@users.noreply.github.com), which are addresses, and no phone number.
  console.log(`personal_data on: ${emails} email addresses (the git author lines) and ${phones} phone numbers found`)
  if (phones > 0) fail(`personal_data found ${phones} phone numbers in log text that holds none`)
}

const speedItems: { id: string; text: () => string; registered?: string[] }[] = [
  ...speedSet(),
  // Found by /verify: these were quadratic, outside the deadline.
  { id: 'adversarial-placeholder-starts', text: () => '[REDACTED:'.repeat(400_000) },
]
console.log(`speed, one call, limit ${BUDGET_MS} ms:`)
for (const item of speedItems) {
  const built = performance.now()
  const r = redactor((item.registered ?? []).map(value => ({ value, label: 'SPEED', added: '2026-11-01' })))
  const buildMs = performance.now() - built
  const text = item.text()
  const t0 = performance.now()
  const out = r.redactText(text, { deadline: performance.now() + BUDGET_MS })
  const took = performance.now() - t0
  console.log(`  ${item.id.padEnd(38)} ${(text.length / 1024).toFixed(0).padStart(6)} KB  ${ms(took).padStart(11)}  hits ${String(out.hits.length).padStart(6)}  complete ${out.complete}${item.registered ? `  (built in ${ms(buildMs)})` : ''}`)
  if (took > BUDGET_MS + 1000) fail(`${item.id} ran past its deadline`)
  if (took > TARGETS.pipelineMs) fail(`${item.id} took ${took.toFixed(0)} ms, over the target ${TARGETS.pipelineMs} ms`)
  if (!out.complete) fail(`${item.id} did not finish`)
}

// ---- 8. the backup lock as a program -----------------------------------------------------------------

console.log('\n== 8. The backup lock: a cold Node process handling one small event ==')
{
  const main = path.join(root, 'plugin', 'backup', 'backup', 'main.js')
  if (!fs.existsSync(main)) fail('plugin/backup is not built: run npm run plugin:build')
  else {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-backup-'))
    try {
      const times: number[] = []
      for (let i = 0; i < 9; i++) {
        const input = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'measure', cwd: cfg, tool_name: 'Bash', tool_input: { command: 'npm test' } })
        const t0 = performance.now()
        const r = spawnSync(process.execPath, [main], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } })
        times.push(performance.now() - t0)
        if (r.status !== 0) fail(`the backup lock exited ${r.status}`)
      }
      times.sort((a, b) => a - b)
      const median = times[Math.floor(times.length / 2)] as number
      console.log(`  median ${median.toFixed(0)} ms, slowest ${(times[times.length - 1] as number).toFixed(0)} ms (target: median under ${TARGETS.backupHookMs} ms)`)
      if (median > TARGETS.backupHookMs) fail(`the backup lock median ${median.toFixed(0)} ms is over the target ${TARGETS.backupHookMs} ms`)
    } finally {
      fs.rmSync(cfg, { recursive: true, force: true })
    }
  }
}

console.log(failed ? '\nmeasure: FAILED' : '\nmeasure: ok')
process.exit(failed ? 1 : 0)
