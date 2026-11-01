// Step 4's pure parts: outbound (§11), the overwrite guard (§10, R-11), self-protection (§17), .env
// parsing (§8), the version check (R-01), media (§6) and the self-check (§15). Fakes are built from pieces.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { now } from '../src/core/decoder.ts'
import { NO_ALLOW, Redactor } from '../src/core/session.ts'
import { base64Encode, utf8 } from '../src/core/forms.ts'
import { isChecked, outboundText, outboundVerdict } from '../src/core/outbound.ts'
import { applyEdit, checkOverwrite, placeholdersIn } from '../src/core/guard.ts'
import { blockedSettingsChange, isProtected, isSettingsFile, normalize, shellChangesProtected, type Roots } from '../src/core/protect.ts'
import { MAX_REGISTERED, MIN_REGISTERED, parseEnv, startsTicked, validRegistered } from '../src/core/envfile.ts'
import { isTested, versionWarning } from '../src/core/versions.ts'
import { dropMedia, hasMedia } from '../src/core/media.ts'
import { reportText, runSelfCheck } from '../src/core/selfcheck.ts'
import type { RowMessage } from '../src/core/rows.ts'

const GH = ['ghp', 'Qw3rTy7UiOp9AsDf1GhJk5LzXc8VbNm2ZxCv'].join('_')
const REG = ['acme', 'internal', 'Zq93Kd'].join('-')
const later = (): number => now() + 2000
const redactor = (registered: { value: string; label: string; added: string; harmless?: true }[] = []): Redactor =>
  new Redactor({ checker: createChecker({}).checker, registered, hints: true, allow: NO_ALLOW })

// ---- session additions -------------------------------------------------------------------

test('findKnown sees a registered value and a caught one, in plain and encoded form, and nothing new', () => {
  const r = redactor([{ value: REG, label: 'mine', added: '2026-11-01' }])
  assert.equal(r.findKnown(`curl -d ${REG}`, later()).hits.length, 1)
  assert.equal(r.findKnown(`x ${base64Encode(utf8(REG), false)} y`, later()).hits.length, 1)
  assert.equal(r.findKnown(`x ${GH} y`, later()).hits.length, 0, 'an unseen shape is not "known"')
  r.redactText(GH, { deadline: later() })
  assert.equal(r.findKnown(`x ${GH} y`, later()).hits.length, 1)
})

test('findKnown skips a value inside a placeholder', () => {
  const r = redactor()
  const out = r.redactText(GH, { deadline: later() }).text
  assert.equal(r.findKnown(out, later()).hits.length, 0)
})

test('allowTag makes a caught value harmless: not hidden, not known, and it stays that way', () => {
  const r = redactor()
  const hit = r.redactText(GH, { deadline: later() }).hits[0]
  assert.ok(hit)
  assert.equal(r.valueOfTag(hit.tag), GH)
  assert.equal(r.allowTag(hit.tag), true)
  assert.equal(r.redactText(`again ${GH}`, { deadline: later() }).text, `again ${GH}`)
  assert.equal(r.findKnown(GH, later()).hits.length, 0)
})

test('allowTag works on a registered value, and refuses a tag it never made', () => {
  const r = redactor([{ value: REG, label: 'mine', added: '2026-11-01' }])
  const hit = r.redactText(REG, { deadline: later() }).hits[0]
  assert.ok(hit)
  assert.equal(r.allowTag('aaaaaaaaaaaaa'), false)
  assert.equal(r.allowTag('constructor'), false)
  assert.equal(r.allowTag(hit.tag), true)
  assert.equal(r.redactText(REG, { deadline: later() }).text, REG)
})

test('a list entry marked harmless is never hidden, even when its shape would be', () => {
  const r = redactor([{ value: GH, label: 'x', added: '2026-11-01', harmless: true }])
  assert.equal(r.redactText(GH, { deadline: later() }).text, GH)
})

// ---- outbound -----------------------------------------------------------------------------

test('commands, web and connected tools are checked; purely local tools are not', () => {
  for (const t of ['Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'mcp__x__y', 'Agent', 'SomethingNew']) assert.equal(isChecked(t), true, t)
  for (const t of ['Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'TodoWrite']) assert.equal(isChecked(t), false, t)
})

test('outboundText reads every string in the input, deep, and skips the envelope', () => {
  const t = outboundText({ tool: 'Bash', tool_use_id: 'tid', agentId: 'aid', command: 'a', nested: { list: ['b', 1, { c: 'd' }] } })
  for (const w of ['a', 'b', 'd']) assert.ok(t.split('\n').includes(w))
  assert.ok(!t.includes('tid') && !t.includes('aid') && !t.includes('Bash'))
})

test('outboundText survives a looping input', () => {
  const o: Record<string, unknown> = { a: 'x' }
  o.self = o
  assert.equal(outboundText(o), 'x')
})

test('each outbound setting gives its verdict, and no hit means go', () => {
  const hits = [{ tag: 't', label: 'L' }]
  assert.equal(outboundVerdict('block', hits), 'block')
  assert.equal(outboundVerdict('ask', hits), 'ask')
  assert.equal(outboundVerdict('warn', hits), 'warn')
  assert.equal(outboundVerdict('off', hits), 'go')
  assert.equal(outboundVerdict('block', []), 'go')
})

// ---- overwrite guard ----------------------------------------------------------------------

test('R-11: a Write that swaps a real secret for its own placeholder is blocked', () => {
  const r = redactor()
  const disk = `name=a\ntoken=${GH}\n`
  const seen = r.redactText(disk, { deadline: later() }).text
  const out = checkOverwrite(r, { path: 'c.env', disk, after: seen, deadline: later() })
  assert.equal(out.blocked, true)
  assert.ok(out.tags.length > 0)
})

test('a Write that keeps the real secret, or has no placeholder, goes through', () => {
  const r = redactor()
  const disk = `token=${GH}\n`
  const seen = r.redactText(disk, { deadline: later() }).text
  assert.equal(checkOverwrite(r, { path: 'c.env', disk, after: `${disk}x=${seen}\n`, deadline: later() }).blocked, false)
  assert.equal(checkOverwrite(r, { path: 'c.env', disk, after: 'other\n', deadline: later() }).blocked, false)
})

test('a placeholder from an earlier session, with a same-kind secret on disk, is blocked too', () => {
  const old = redactor()
  const disk = `${GH}\n`
  const stale = old.redactText(disk, { deadline: later() }).text
  const r = redactor()
  assert.equal(checkOverwrite(r, { path: 'a.txt', disk, after: stale, deadline: later() }).blocked, true)
})

test('a file with no secret never blocks, and CRLF and Unicode are fine', () => {
  const r = redactor()
  assert.equal(checkOverwrite(r, { path: 'a.txt', disk: 'héllo\r\n日本語\r\n', after: '[REDACTED:X #abcdefghijklm]\r\n', deadline: later() }).blocked, false)
})

test('a check out of time says incomplete', () => {
  const r = redactor()
  assert.equal(checkOverwrite(r, { path: 'a', disk: `${GH}\n`, after: 'x', deadline: now() - 1 }).complete, false)
})

test('placeholdersIn gives each one its line and tag', () => {
  const r = redactor()
  const p = r.redactText(GH, { deadline: later() }).text
  const found = placeholdersIn(`a\r\nb ${p}\nc\n${p}`)
  assert.deepEqual(found.map(f => f.line), [2, 4])
  assert.match(found[0]?.tag as string, /^[a-z2-7]{13}$/)
})

// ---- self-protection ----------------------------------------------------------------------

const roots: Roots = { own: ['C:\\Users\\me\\.claude\\aegiscontext', 'C:\\plugins\\shield'], config: 'C:\\Users\\me\\.claude', caseless: true }

test('paths are normalized: separators, dots and case on Windows', () => {
  assert.equal(normalize('C:\\a\\b\\..\\c\\.\\d', true), 'c:/a/c/d')
  assert.equal(normalize('/A/b//c/', false), '/A/b/c')
})

test("the tool's own folders are protected however they are spelled, and a look-alike is not", () => {
  assert.equal(isProtected('C:\\Users\\me\\.claude\\aegiscontext\\log\\x.jsonl', roots), true)
  assert.equal(isProtected('c:/users/ME/.claude/x/../aegiscontext/store/index.dpapi', roots), true)
  assert.equal(isProtected('C:\\plugins\\shield', roots), true)
  assert.equal(isProtected('C:\\plugins\\shield-other\\a', roots), false)
})

test("Claude Code's settings files are recognised", () => {
  for (const f of ['D:\\p\\.claude\\settings.json', 'D:/p/.claude/settings.local.json', 'C:\\Users\\me\\.claude\\settings.json', 'C:\\Program Files\\ClaudeCode\\managed-settings.json']) assert.equal(isSettingsFile(f, roots), true, f)
  for (const f of ['D:\\p\\settings.json', 'D:\\p\\.vscode\\settings.json']) assert.equal(isSettingsFile(f, roots), false, f)
})

test('a change to a kill switch is refused; any other settings change passes', () => {
  const before = JSON.stringify({ permissions: { allow: [] } })
  for (const key of ['disableAllHooks', 'allowManagedHooksOnly', 'hooks', 'enabledPlugins', 'aegisContext']) {
    assert.equal(blockedSettingsChange(before, JSON.stringify({ permissions: { allow: [] }, [key]: true })), key)
  }
  assert.equal(blockedSettingsChange(before, JSON.stringify({ env: { CLAUDE_CODE_SIMPLE: '1' } })), 'CLAUDE_CODE_SIMPLE')
  assert.equal(blockedSettingsChange(before, JSON.stringify({ permissions: { allow: ['Bash'] }, theme: 'dark' })), undefined)
})

test('removing a kill switch is refused too, and an unreadable result that names one is refused', () => {
  assert.equal(blockedSettingsChange(JSON.stringify({ aegisContext: { mode: 'enforce' } }), '{}'), 'aegisContext')
  assert.equal(blockedSettingsChange('{}', '{ "disableAllHooks": true, // comment\n}'), 'disableAllHooks')
  assert.equal(blockedSettingsChange('', '{ not json'), undefined)
})

test('a shell command that changes a protected path or a kill switch is refused; reading is not', () => {
  for (const c of [
    'rm -rf "C:/Users/me/.claude/aegiscontext"',
    'echo x > C:\\Users\\me\\.claude\\aegiscontext\\log\\a',
    'Remove-Item C:\\plugins\\shield\\hooks\\register.ts',
    `echo '{"disableAllHooks":true}' > .claude/settings.local.json`,
    'sed -i s/a/b/ .claude/settings.json',
    'claude plugin disable aegiscontext',
    'claude plugin uninstall aegiscontext',
    'security delete-generic-password -s aegiscontext -a index',
    'secret-tool clear service aegiscontext account index',
  ]) assert.ok(shellChangesProtected(c, roots), c)
  for (const c of ['cat C:/Users/me/.claude/aegiscontext/log/a', 'grep disableAllHooks docs/spec.md', 'npm test > out.txt', 'cat .claude/settings.json', 'git commit -m "note"']) assert.equal(shellChangesProtected(c, roots), undefined, c)
})

// ---- .env -----------------------------------------------------------------------------------

test('parseEnv reads export, quotes, comments, CRLF, a BOM and Unicode', () => {
  const pass = ['s3cr', 'et9X'].join('')
  const text = `\uFEFF# top\r\nexport A=${pass}\r\nB="two words"\nC='q#1'\nD=x # note\nE=\nF=日本語\nnot a line\n`
  assert.deepEqual(parseEnv(text).map(e => [e.key, e.value]), [['A', pass], ['B', 'two words'], ['C', 'q#1'], ['D', 'x'], ['F', '日本語']])
})

test('parseEnv is bounded on a huge input', () => {
  const t0 = performance.now()
  assert.ok(parseEnv('A=1\n'.repeat(500_000)).length <= 2000)
  parseEnv('x'.repeat(3_000_000))
  assert.ok(performance.now() - t0 < 2000)
})

test('real-looking values start ticked; placeholders, references and plain settings do not', () => {
  const c = createChecker({}).checker
  assert.equal(startsTicked(c, 'GITHUB_TOKEN', GH), true)
  assert.equal(startsTicked(c, 'DB_PASSWORD', ['Harbor', '.Meadow7'].join('')), true)
  assert.equal(startsTicked(c, 'DB_PASSWORD', '${DB_PASS}'), false)
  assert.equal(startsTicked(c, 'API_KEY', 'your-key-here'), false)
  assert.equal(startsTicked(c, 'PORT', '8080'), false)
  assert.equal(startsTicked(c, 'NODE_ENV', 'production'), false)
})

test('a registered value is 6 to 8,192 characters', () => {
  assert.equal(MIN_REGISTERED, 6)
  assert.equal(MAX_REGISTERED, 8192)
  assert.equal(validRegistered('12345'), 'too short')
  assert.equal(validRegistered('123456'), undefined)
  assert.equal(validRegistered('x'.repeat(8193)), 'too long')
  assert.equal(validRegistered('   abcdef\n'), 'has spaces at the ends')
})

// ---- versions ------------------------------------------------------------------------------

test('R-01: an untested version gives one line; a tested one none', () => {
  assert.equal(isTested('2.1.316'), true)
  assert.equal(versionWarning('2.1.316'), undefined)
  const w = versionWarning('9.9.9') as string
  assert.match(w, /9\.9\.9/)
  assert.ok(!w.includes('\n'))
})

// ---- media ---------------------------------------------------------------------------------

const image = { type: 'image', source: { type: 'base64', data: 'AAAA' } }
const doc = { type: 'document', source: { type: 'base64', data: 'BBBB' } }

test('drop removes top-level and nested media, and leaves a note for Claude', () => {
  const row: RowMessage = { type: 'user', content: [image, { type: 'text', text: 'hi' }, { type: 'tool_result', tool_use_id: 't', content: [image, doc, { type: 'text', text: 'k' }] }] }
  assert.equal(hasMedia(row), true)
  const out = dropMedia(row)
  assert.equal(out.dropped, 3)
  assert.equal(hasMedia(out.message), false)
  assert.match(JSON.stringify(out.message), /removed/)
  assert.match(JSON.stringify(out.message), /"tool_use_id":"t"/)
})

test('a row with no media is returned as it is', () => {
  const row: RowMessage = { type: 'user', content: [{ type: 'text', text: 'hi' }] }
  const out = dropMedia(row)
  assert.equal(out.message, row)
  assert.equal(out.dropped, 0)
})

// ---- self-check ------------------------------------------------------------------------------

test('every self-check case passes, and neither result nor report holds a fake', () => {
  const results = runSelfCheck(() => createChecker({}).checker)
  assert.ok(results.length >= 8)
  assert.deepEqual(results.filter(r => !r.pass).map(r => r.name), [])
  const report = reportText(results, { version: '0.1.0', engine: '2.1.316', os: 'windows', date: '2026-11-01' })
  assert.match(report, /2\.1\.316/)
  assert.ok(!/ghp_[A-Za-z0-9]{20}|AKIA[A-Z0-9]{12}/.test(report))
  assert.ok(!/ghp_[A-Za-z0-9]{20}/.test(JSON.stringify(results)))
})

test('a broken checker makes the self-check fail, not crash', () => {
  const results = runSelfCheck(() => {
    throw new Error('no')
  })
  assert.ok(results.some(r => !r.pass))
})

// ---- found by mutation checks ------------------------------------------------------------------

const GH2 = ['ghp', 'Zx8Vb2NmLk4JhGf6DsAq1WeRt9YuIo3PaSdF'].join('_')
const place = (r: Redactor, text: string): string => r.redactText(text, { deadline: later() }).text

test('applyEdit: an empty old string does nothing, one edit changes the first, replace_all every one, and $ stays literal', () => {
  assert.equal(applyEdit('abc', '', 'x', false), undefined)
  assert.equal(applyEdit('a a', 'a', 'b', false), 'b a')
  assert.equal(applyEdit('a a', 'a', 'b', true), 'b b')
  assert.equal(applyEdit('a', 'a', '$&$&', false), '$&$&')
})

test('the guard: a placeholder already in the file does not count as losing a secret', () => {
  const r = redactor()
  const old = place(r, GH)
  const fresh = redactor()
  fresh.redactText(`x ${GH2}`, { deadline: later() })
  const disk = `a=${old}\nb=${GH2}\n`
  assert.equal(checkOverwrite(fresh, { path: 'a.env', disk, after: `a=${old}\n`, deadline: later() }).blocked, false)
})

test('the guard: the placeholder of a different known value of the same kind does not count', () => {
  const r = redactor()
  const other = place(r, GH2)
  r.redactText(`seen ${GH}`, { deadline: later() })
  assert.equal(checkOverwrite(r, { path: 'a.env', disk: `a=${GH}\n`, after: `a=${other}\n`, deadline: later() }).blocked, false)
})

test('the guard: a rule set to warn hides nothing, so nothing is lost', () => {
  const r = new Redactor({ checker: createChecker({ actions: { 'github-pat': 'warn' } }).checker, registered: [], hints: true, allow: NO_ALLOW })
  const held = redactor()
  const seen = place(held, GH)
  assert.equal(checkOverwrite(r, { path: 'a.env', disk: `a=${GH}\n`, after: `a=${seen}\n`, deadline: later() }).blocked, false)
})

test('the guard says when its check did not finish', () => {
  assert.equal(checkOverwrite(redactor(), { path: 'a.env', disk: `a=${GH}\n`, after: 'b', deadline: now() - 1 }).complete, false)
})

test('a shell command naming a kill switch and settings is refused', () => {
  const roots: Roots = { own: ['/data'], config: '/cfg', caseless: false }
  assert.equal(shellChangesProtected(`node -e "update('settings', 'disableAllHooks')"`, roots), 'Claude Code settings')
})

test('parseEnv skips a byte order mark', () => {
  assert.equal(parseEnv('﻿API_KEY=abc')[0]?.key, 'API_KEY')
})

test('startsTicked: a value that can not be saved, or a rule that only warns, starts unticked', () => {
  assert.equal(startsTicked(createChecker({}).checker, 'PASSWORD', 'Kq7'.repeat(3000)), false)
  assert.equal(startsTicked(createChecker({ actions: { 'github-pat': 'warn' } }).checker, 'NOTE', GH), false)
})

test('allowing a value gives its room in the catch list back', () => {
  const r = new Redactor({ checker: createChecker({}).checker, registered: [], hints: true, allow: NO_ALLOW, maxCatchChars: 40 })
  const tag = (r.redactText(GH, { deadline: later() }).hits[0] as { tag: string }).tag
  r.allowTag(tag)
  r.redactText(GH2, { deadline: later() })
  assert.equal(r.findKnown(`x ${GH2} y`, later()).hits.length, 1)
})

test('the self-check fails when the checker finds nothing', () => {
  const results = runSelfCheck(() => ({ scan: () => ({ findings: [], complete: true }) }) as never)
  const failed = results.filter(x => !x.pass).map(x => x.name)
  assert.ok(failed.includes('a known key format is hidden'))
  assert.ok(failed.includes('the same value gets the same tag'))
})
