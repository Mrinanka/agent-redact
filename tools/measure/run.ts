// npm run measure: prints the numbers step 2 is judged by.
//   1. rules: converted and rejected, with reasons
//   2. catch rate by context and by format (decoder-dependent cases shown apart)
//   3. the code set (R-08)
//   4. false alarms per MB, by rule
//   5. speed per item, under Node
// Exits 1 if an automated "done when" fails, so CI notices. Prints labels and
// counts only, never a value.

import path from 'node:path'
import fs from 'node:fs'
import { createChecker } from '../../src/checker/index.ts'
import { REJECTIONS, RULES, BUILD_WARNINGS, GITLEAKS_VERSION } from '../../src/checker/rules.generated.ts'
import { catchSet, type CatchCase } from '../test-sets/catch.ts'
import { codeSet } from '../test-sets/code.ts'
import { falseAlarmFiles } from '../test-sets/false-alarm.ts'
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

console.log(failed ? '\nmeasure: FAILED' : '\nmeasure: ok')
process.exit(failed ? 1 : 0)
