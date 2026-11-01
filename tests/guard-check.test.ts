// The built-in guard check (plan step 6, spec §5.3 and §22): when Claude Code routes events past a user-tier
// plugin, nothing in the plugin can fix it, so it says so once. These are the pure parts: what the facts mean,
// the words the person reads, and the doctor lines. The hook behaviour is in plugin/hooks/lock.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardDoctorLines, guardFix, guardHeld, guardState, guardWarning, managedInstall } from '../src/core/guard-check.ts'

test('an install is Managed by our own key or our own plugin, not by any plugin the policy names', () => {
  assert.equal(managedInstall({}), false)
  assert.equal(managedInstall({ permissions: { deny: [] } }), false)
  assert.equal(managedInstall({ enabledPlugins: { 'other@market': true } }), false)
  assert.equal(managedInstall({ enabledPlugins: { 'aegiscontext@aegiscontext': false } }), false)
  assert.equal(managedInstall({ enabledPlugins: 'not an object' }), false)
  assert.equal(managedInstall({ enabledPlugins: { 'aegiscontext@aegiscontext': true } }), true)
  assert.equal(managedInstall({ enabledPlugins: { 'aegiscontext@company-market': true } }), true)
  assert.equal(managedInstall({ aegisContext: {} }), true)
})

test('compose seen means events reach the plugin, whatever else is known', () => {
  assert.equal(guardState({ composeSeen: true, warned: false, tier: 'user', policy: true }), 'reaches')
  assert.equal(guardState({ composeSeen: true, warned: true, tier: 'user', policy: true }), 'reaches')
})

test('a main step with no compose seen is a pass-over; before any step it is not known yet', () => {
  assert.equal(guardState({ composeSeen: false, warned: true, tier: 'user', policy: false }), 'passed-over')
  assert.equal(guardState({ composeSeen: false, warned: false, tier: 'user', policy: true }), 'unknown')
  assert.equal(guardState({ composeSeen: false, warned: false, tier: undefined, policy: false }), 'unknown')
})

test('the warning names what is not checked and the fix, and holds no value', () => {
  const w = guardWarning()
  for (const word of ['instruction files', 'hook context', 'skill text', 'attachments', 'compaction', 'organization plugin', 'docs/managed.md']) assert.ok(w.includes(word), word)
  assert.ok(!w.includes('project instruction'), 'all loaded instruction files, not only the project\'s')
  assert.ok(!w.includes('a check failed'), 'it is not a failed check')
  assert.ok(w.length < 400, 'short enough for a toast')
})

test('the warning names every sign of the guard, each one enough alone', () => {
  const w = guardWarning()
  for (const sign of ['managed settings', 'managed MCP', 'Team or Enterprise']) assert.ok(w.includes(sign), sign)
  assert.ok(!/and with/.test(w), 'any one of them seats the guard')
})

test('a held request says why, how to fix it, and that it was not sent', () => {
  const h = guardHeld()
  for (const word of ['not sent', 'hold', 'instruction files', 'hook context', 'skill text', 'organization plugin', 'docs/managed.md', 'on_check_failure']) assert.ok(h.includes(word), word)
})

test('the doctor line for a pass-over names the same doors as the warning', () => {
  const lines = guardDoctorLines({ composeSeen: false, warned: true, tier: 'user', policy: true }).join('\n')
  for (const word of ['instruction files', 'hook context', 'skill text', 'attachments', 'compaction']) assert.ok(lines.includes(word), word)
  assert.ok(!lines.includes('project instruction'))
})

test('doctor lines: tier, then the guard, and a fix only for a pass-over', () => {
  const passed = guardDoctorLines({ composeSeen: false, warned: true, tier: 'user', policy: true })
  assert.deepEqual(passed.slice(0, 1), ['Plugin tier: user.'])
  assert.match(passed.join('\n'), /Built-in guard: .*passed over/i)
  assert.ok(guardFix({ composeSeen: false, warned: true, tier: 'user', policy: true }))
  const fine = guardDoctorLines({ composeSeen: true, warned: false, tier: 'prepend', policy: true })
  assert.equal(fine[0], 'Plugin tier: prepend.')
  assert.match(fine.join('\n'), /Built-in guard: .*reach the plugin/i)
  assert.equal(guardFix({ composeSeen: true, warned: false, tier: 'prepend', policy: true }), undefined)
})

test('doctor lines when the tier cannot be read say so, and an unknown guard asks for a message first', () => {
  const lines = guardDoctorLines({ composeSeen: false, warned: false, tier: undefined, policy: false })
  assert.match(lines[0] ?? '', /Plugin tier: not visible/)
  assert.match(lines.join('\n'), /not known yet/i)
  assert.equal(guardFix({ composeSeen: false, warned: false, tier: undefined, policy: false }), undefined)
})

test('a user plugin on a machine with managed settings is told about the risk even before the first step', () => {
  const lines = guardDoctorLines({ composeSeen: false, warned: false, tier: 'user', policy: true })
  assert.match(lines.join('\n'), /managed settings/i)
})
