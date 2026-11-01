// Settings (spec §14, R-13, R-14, R-15): validation, the 3-level merge, stricter-only, locks.
// A message never holds a setting's value, because an `allow` entry may be a secret.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileAllow, checkerOptions, DEFAULTS, resolveSettings, type SourceName } from '../src/core/settings.ts'
import { createChecker } from '../src/checker/index.ts'

const FAKE = ['Autumn', '2026', 'xkQ'].join('')
const resolve = (sources: Partial<Record<SourceName, unknown>>, lastGood?: ReturnType<typeof resolveSettings>['settings']) =>
  resolveSettings(sources, lastGood ? { lastGood } : {})

test('with nothing set, the defaults of spec §14 apply', () => {
  const r = resolve({})
  assert.deepEqual(r.settings, DEFAULTS)
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
  assert.equal(DEFAULTS.mode, 'enforce')
  assert.equal(DEFAULTS.outbound, 'block')
  assert.equal(DEFAULTS.on_check_failure, 'allow')
  assert.equal(DEFAULTS.media, 'pass')
  assert.equal(DEFAULTS.hints, 'on')
  assert.deepEqual(DEFAULTS.secret_files, ['.env*'])
  assert.equal(DEFAULTS.log.days, 30)
})

test('the user can change any setting', () => {
  const r = resolve({ user: {
    mode: 'observe', personal_data: 'on', outbound: 'off', on_check_failure: 'hold', media: 'drop', hints: 'off', notices: 'off',
    rules: { off: ['npm-access-token'], custom: [{ id: 'acme-token', label: 'ACME', keyword: 'acme_', pattern: 'acme_[a-z0-9]{32}' }], actions: { 'github-pat': 'warn' } },
    allow: ['a-harmless-value', { pattern: 'test-[a-z]+' }], secret_files: ['.secrets*'], log: { days: 7 },
  } })
  assert.deepEqual(r.errors, [])
  const s = r.settings
  assert.equal(s.mode, 'observe')
  assert.equal(s.outbound, 'off')
  assert.equal(s.on_check_failure, 'hold')
  assert.equal(s.media, 'drop')
  assert.equal(s.hints, 'off')
  assert.equal(s.notices, 'off')
  assert.deepEqual(s.rules.off, ['npm-access-token'])
  assert.equal(s.rules.custom.length, 1)
  assert.deepEqual(s.rules.actions, { 'github-pat': 'warn' })
  assert.equal(s.allow.length, 2)
  assert.deepEqual(s.secret_files, ['.secrets*'])
  assert.equal(s.log.days, 7)
})

for (const level of ['project', 'local', 'flag'] as const) {
  test(`${level} settings can only make things stricter (the "cannot" list of spec §14)`, () => {
    const user = { outbound: 'warn', on_check_failure: 'allow', media: 'pass', secret_files: ['.env*', 'creds.*'] }
    // cannot: add allow entries, turn rules off, set observe, loosen outbound / on_check_failure / media, shorten secret_files
    const loosen = resolve({ user, [level]: {
      allow: [FAKE], rules: { off: ['npm-access-token'] }, mode: 'observe', outbound: 'off', secret_files: ['only-this'],
    } })
    assert.deepEqual(loosen.settings.allow, [])
    assert.deepEqual(loosen.settings.rules.off, [])
    assert.equal(loosen.settings.mode, 'enforce')
    assert.equal(loosen.settings.outbound, 'warn')
    assert.ok(loosen.settings.secret_files.includes('.env*') && loosen.settings.secret_files.includes('creds.*'))
    assert.ok(loosen.notices.length >= 4)
    const userHold = resolve({ user: { on_check_failure: 'hold', media: 'drop', outbound: 'block' }, [level]: { on_check_failure: 'allow', media: 'pass', outbound: 'ask' } })
    assert.equal(userHold.settings.on_check_failure, 'hold')
    assert.equal(userHold.settings.media, 'drop')
    assert.equal(userHold.settings.outbound, 'block')
  })

  test(`${level} settings can add custom rules and secret_files patterns, and choose stricter values`, () => {
    const r = resolve({ user: { outbound: 'ask' }, [level]: {
      rules: { custom: [{ id: 'proj-token', label: 'PROJ', keyword: 'proj_', pattern: 'proj_[a-z0-9]{24}' }], actions: { 'github-pat': 'block' } },
      secret_files: ['secrets/*'], outbound: 'block', on_check_failure: 'hold', media: 'drop', personal_data: 'on', hints: 'off',
    } })
    assert.deepEqual(r.errors, [])
    assert.equal(r.settings.rules.custom[0]?.id, 'proj-token')
    assert.ok(r.settings.secret_files.includes('secrets/*') && r.settings.secret_files.includes('.env*'))
    assert.equal(r.settings.outbound, 'block')
    assert.equal(r.settings.on_check_failure, 'hold')
    assert.equal(r.settings.media, 'drop')
    assert.equal(r.settings.personal_data, 'on')
    assert.equal(r.settings.hints, 'off')
    assert.equal(r.settings.rules.actions['github-pat'], 'block')
  })
}

test('a project cannot make a rule action weaker, only stricter', () => {
  const r = resolve({ user: { rules: { actions: { 'github-pat': 'block' } } }, project: { rules: { actions: { 'github-pat': 'warn', 'npm-access-token': 'block' } } } })
  assert.equal(r.settings.rules.actions['github-pat'], 'block')
  assert.equal(r.settings.rules.actions['npm-access-token'], 'block')
})

// `constructor` is the one name on Object.prototype that a custom rule id may be, and a plain lookup
// of it finds a function, not an action. These hold whichever way that lookup could go wrong.

const PAT = ['ghp', 'Qw3rTy7UiOp9AsDf1GhJk5LzXc8VbNm2ZxCv'].join('_')
const STARTS_EARLIER = { id: 'constructor', label: 'X', keyword: 'token', pattern: 'token ghp_[A-Za-z0-9]{36}' }
const OWN_RULE = { id: 'constructor', label: 'X', keyword: 'zzshield', pattern: 'zzshield[A-Za-z0-9]{12}' }
const OWN_VALUE = ['zzshield', 'Tok3nValue99'].join('')

const actionsOn = (r: ReturnType<typeof resolve>, text: string): unknown[] => createChecker(checkerOptions(r.settings)).checker.scan(text, { budgetMs: 2000 }).findings.map(f => f.action)

test('a project rule named constructor cannot undo a block the user set', () => {
  const r = resolve({ user: { rules: { actions: { 'github-pat': 'block' } } }, project: { rules: { custom: [STARTS_EARLIER] } } })
  assert.deepEqual(actionsOn(r, `token ${PAT} end`), ['block'])
})

test('a project rule named constructor cannot undo a block that managed settings locked', () => {
  const r = resolve({ policy: { rules: { actions: { 'github-pat': 'block' } }, locked: ['rules.actions'] }, project: { rules: { custom: [STARTS_EARLIER] } } })
  assert.deepEqual(actionsOn(r, `token ${PAT} end`), ['block'])
})

test('a custom rule named constructor hides by default, like any other rule', () => {
  assert.deepEqual(actionsOn(resolve({ user: { rules: { custom: [OWN_RULE] } } }), `here ${OWN_VALUE} there`), ['hide'])
})

test('a project cannot weaken a rule named constructor, and is told so', () => {
  const r = resolve({ user: { rules: { custom: [OWN_RULE] } }, project: { rules: { actions: { constructor: 'warn' } } } })
  assert.deepEqual(actionsOn(r, `here ${OWN_VALUE} there`), ['hide'])
  assert.ok(r.notices.some(n => n.includes('rules.actions')))
})

test('a rule named constructor can still be set: stricter by a project, anything by the user', () => {
  const stricter = resolve({ user: { rules: { custom: [OWN_RULE] } }, project: { rules: { actions: { constructor: 'block' } } } })
  assert.deepEqual(actionsOn(stricter, `here ${OWN_VALUE} there`), ['block'])
  const user = resolve({ user: { rules: { custom: [OWN_RULE], actions: { constructor: 'warn' } } } })
  assert.deepEqual(actionsOn(user, `here ${OWN_VALUE} there`), ['warn'])
})

test('R-13: only managed or user settings turn on observe mode, never project ones', () => {
  assert.equal(resolve({ project: { mode: 'observe' } }).settings.mode, 'enforce')
  assert.equal(resolve({ local: { mode: 'observe' } }).settings.mode, 'enforce')
  assert.equal(resolve({ flag: { mode: 'observe' } }).settings.mode, 'enforce')
  assert.equal(resolve({ user: { mode: 'observe' } }).settings.mode, 'observe')
  assert.equal(resolve({ policy: { mode: 'observe' } }).settings.mode, 'observe')
})

test('managed settings are the base; the user may change what is not locked', () => {
  const r = resolve({ policy: { on_check_failure: 'hold', outbound: 'ask' }, user: { on_check_failure: 'allow', outbound: 'block' } })
  assert.equal(r.settings.on_check_failure, 'allow')
  assert.equal(r.settings.outbound, 'block')
})

test('a locked setting keeps its managed value (or the default) against the user and the project', () => {
  const r = resolve({
    policy: { on_check_failure: 'hold', locked: ['on_check_failure', 'media', 'rules.off', 'allow'] },
    user: { on_check_failure: 'allow', media: 'drop', rules: { off: ['npm-access-token'] }, allow: ['x-harmless-value'] },
    project: { on_check_failure: 'allow' },
  })
  assert.equal(r.settings.on_check_failure, 'hold')
  assert.equal(r.settings.media, 'pass', 'locked at its default')
  assert.deepEqual(r.settings.rules.off, [])
  assert.deepEqual(r.settings.allow, [])
  assert.deepEqual(r.settings.locked, ['on_check_failure', 'media', 'rules.off', 'allow'])
  assert.ok(r.notices.some(n => n.includes('locked')))
  // Locking "rules" locks all three rule settings.
  const rules = resolve({ policy: { locked: ['rules'] }, user: { rules: { actions: { 'github-pat': 'warn' } } } })
  assert.deepEqual(rules.settings.rules.actions, {})
})

test('only managed settings can lock, and lock names are checked', () => {
  assert.deepEqual(resolve({ user: { locked: ['media'] } }).settings.locked, [])
  const bad = resolve({ policy: { locked: ['nonsense'] } })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.join('\n'), /locked/)
})

test('wrong types and out-of-range values are errors that name the setting but not its value', () => {
  const cases: [unknown, RegExp][] = [
    [{ mode: 'loud' }, /mode/], [{ outbound: 3 }, /outbound/], [{ hints: true }, /hints/], [{ log: { days: 0 } }, /log\.days/],
    [{ log: { days: 'many' } }, /log\.days/], [{ rules: { off: 'x' } }, /rules\.off/], [{ rules: { actions: { 'a-b': 'explode' } } }, /rules\.actions/],
    [{ allow: [42] }, /allow/], [{ secret_files: 'x' }, /secret_files/], [{ rules: { custom: [{ id: 'x' }] } }, /rules\.custom/], ['text', /secretShield/], [[1, 2], /secretShield/],
  ]
  for (const [value, pattern] of cases) {
    const r = resolve({ user: value })
    assert.equal(r.ok, false, JSON.stringify(value))
    assert.match(r.errors.join('\n'), pattern)
  }
  const secret = resolve({ user: { allow: [FAKE, 7], on_check_failure: FAKE } })
  assert.ok(!secret.errors.join('\n').includes(FAKE))
  assert.ok(!secret.notices.join('\n').includes(FAKE))
})

test('R-14: a broken value keeps the last good settings, or the defaults', () => {
  const good = resolve({ user: { on_check_failure: 'hold', hints: 'off' } }).settings
  const broken = resolve({ user: { on_check_failure: 'hold', hints: 'sometimes' } }, good)
  assert.equal(broken.ok, false)
  assert.deepEqual(broken.settings, good)
  const fresh = resolve({ user: { hints: 'sometimes' } })
  assert.deepEqual(fresh.settings, DEFAULTS)
})

test('unknown keys are a notice, not an error', () => {
  const r = resolve({ user: { flavour: 'mint', hints: 'off' } })
  assert.equal(r.ok, true)
  assert.equal(r.settings.hints, 'off')
  assert.ok(r.notices.some(n => n.includes('flavour')))
})

test('a setting that does nothing yet says so: personal_data on. Media drop and observe mode now work', () => {
  assert.ok(resolve({ user: { personal_data: 'on' } }).notices.some(n => /personal_data.*not available yet/.test(n)))
  assert.ok(!resolve({ user: { media: 'drop' } }).notices.some(n => /not available yet/.test(n)))
  assert.ok(!resolve({ user: { mode: 'observe' } }).notices.some(n => /not available yet/.test(n)))
  assert.equal(resolve({ user: { hints: 'off' } }).notices.length, 0)
})

test('custom rules and rule settings reach the checker; a stuck custom pattern is rejected with a reason (R-15)', () => {
  const stuck = { id: 'stuck-rule', label: 'STUCK', keyword: 'aaa', pattern: 'aaa(a+)+b' }
  const fine = { id: 'acme-token', label: 'ACME', keyword: 'acme_', pattern: 'acme_[a-z0-9]{32}' }
  const r = resolve({ user: { rules: { custom: [stuck, fine], off: ['npm-access-token'], actions: { 'github-pat': 'warn' } } } })
  assert.deepEqual(r.errors, [])
  const opts = checkerOptions(r.settings)
  assert.deepEqual(opts.off, ['npm-access-token'])
  assert.deepEqual(opts.actions, { 'github-pat': 'warn' })
  const { errors } = createChecker(opts)
  assert.deepEqual(errors.map(e => e.id), ['stuck-rule'])
  assert.ok(errors[0]!.reason.length > 5)
})

test('allow: values are exact, patterns match the whole value, and a stuck pattern is refused', () => {
  const { allow, errors } = compileAllow(['exact-value-123', { pattern: 'test-[a-z]{3,8}' }, { pattern: '(a+)+$' }, { pattern: '(' }])
  assert.equal(errors.length, 2)
  assert.ok(allow.values.has('exact-value-123'))
  assert.equal(allow.patterns.length, 1)
  const p = allow.patterns[0] as RegExp
  assert.ok(p.test('test-abc'))
  assert.ok(!p.test('xtest-abc'), 'anchored at the start')
  assert.ok(!p.test('test-abcxxxxxxxxxx'), 'anchored at the end')
  assert.ok(!errors.join('\n').includes('exact-value'))
})
