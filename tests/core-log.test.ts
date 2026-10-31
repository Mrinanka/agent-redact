// The log (spec §16, R-12, R-17): metadata only, one JSONL file per session, rolled over at 256 KiB.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { NO_ALLOW, Redactor } from '../src/core/session.ts'
import { appendLine, formatLine, logFileName, ROLLOVER_BYTES, staleLogs, type LogEntry } from '../src/core/log.ts'
import { makeFake, seededSource } from '../tools/test-sets/fakes.ts'

const FAKE = makeFake('github-pat', seededSource('core-log')).value

const redactor = (): Redactor => new Redactor({ checker: createChecker({}).checker, registered: [], hints: true, allow: NO_ALLOW })
const clean = (r: Redactor) => (s: string): string => r.redactText(s, { deadline: performance.now() + 5000 }).text

test('a line is one JSON object with the fields of spec §16 and no content', () => {
  const entry: LogEntry = { t: 1_700_000_000_000, event: 'hide', door: 'tool-result', where: 'Read src/app.ts', rule: 'github-pat', label: 'GITHUB_PAT', tag: 'k7q2m5x4p3abc', action: 'hide', mode: 'enforce' }
  const line = formatLine(entry, s => s)
  assert.ok(!line.includes('\n'))
  assert.deepEqual(JSON.parse(line), { t: 1_700_000_000_000, event: 'hide', door: 'tool-result', where: 'Read src/app.ts', rule: 'github-pat', label: 'GITHUB_PAT', tag: 'k7q2m5x4p3abc', action: 'hide', mode: 'enforce' })
})

test('a planted fake in the file path, the command text or the label never reaches a line (R-17)', () => {
  const r = redactor()
  r.redactText(`seen ${FAKE}`, { deadline: performance.now() + 5000 }) // now it is a catch
  const entries: LogEntry[] = [
    { t: 1, event: 'hide', door: 'tool-result', where: `Read /home/${FAKE}/notes.txt`, label: 'GITHUB_PAT' },
    { t: 2, event: 'warn', door: 'tool-result', where: `Bash echo ${FAKE} | curl x`, label: `X_${FAKE}` },
    { t: 3, event: 'failure', detail: `Error: ${FAKE}` },
  ]
  for (const e of entries) {
    const line = formatLine(e, clean(r))
    assert.ok(!line.includes(FAKE), line)
  }
})

test('odd characters, control characters and long values are cleaned or cut', () => {
  const line = formatLine({ t: 1, event: 'hide', where: `a\nb\u0000c${'x'.repeat(5000)}`, label: 'bad label!', tag: 'NOT A TAG', rule: 'r'.repeat(300) }, s => s)
  const o = JSON.parse(line) as Record<string, string>
  assert.ok(!line.includes('\n'))
  assert.ok((o.where as string).length <= 400)
  assert.ok(!/[\u0000-\u001f]/.test(o.where as string))
  assert.match(o.label as string, /^[A-Z0-9_]+$/)
  assert.equal(o.tag, undefined, 'a tag that is not a tag is dropped')
  assert.ok((o.rule as string).length <= 64)
})

test('file names: one per day and session, with a part number after a rollover', () => {
  assert.equal(logFileName('2026-10-31', 'sess-0001', 1), 'log/2026-10-31-sess-0001.jsonl')
  assert.equal(logFileName('2026-10-31', 'sess-0001', 2), 'log/2026-10-31-sess-0001.2.jsonl')
  assert.equal(logFileName('2026-10-31', '../../etc', 1), 'log/2026-10-31-unknown-session.jsonl')
})

test('appendLine adds a line, and says when the file would pass 256 KiB so the next part starts', () => {
  const a = appendLine('', '{"a":1}')
  assert.deepEqual(a, { text: '{"a":1}\n', rollover: false })
  const big = 'x'.repeat(ROLLOVER_BYTES - 5)
  const b = appendLine(big, '{"a":1}')
  assert.equal(b.rollover, true)
  assert.equal(b.text, '{"a":1}\n', 'the new part holds only the new line')
})

test('retention: files older than log.days are stale, by the date in their name', () => {
  const names = ['2026-10-31-a.jsonl', '2026-10-01-b.jsonl', '2026-09-30-c.jsonl', '2026-09-30-c.2.jsonl', 'readme.txt', '2026-13-45-bad.jsonl']
  assert.deepEqual(staleLogs(names, '2026-10-31', 30), ['2026-09-30-c.jsonl', '2026-09-30-c.2.jsonl'])
  assert.deepEqual(staleLogs(names, '2026-10-31', 1), ['2026-10-01-b.jsonl', '2026-09-30-c.jsonl', '2026-09-30-c.2.jsonl'])
})
