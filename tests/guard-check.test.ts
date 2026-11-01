// The built-in guard check (plan step 6, spec §5.3 and §22): when Claude Code routes events past a user-tier
// plugin, nothing in the plugin can fix it, so it says so once. These are the pure parts: what the facts mean,
// the words the person reads, and the doctor lines. The hook behaviour is in plugin/hooks/lock.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardDoctorLines, guardFix, guardState, guardWarning } from '../src/core/guard-check.ts'

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
  for (const word of ['project instruction', 'attachments', 'compaction', 'organization plugin', 'docs/managed.md']) assert.ok(w.includes(word), word)
  assert.ok(!w.includes('a check failed'), 'it is not a failed check')
  assert.ok(w.length < 400, 'short enough for a toast')
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
