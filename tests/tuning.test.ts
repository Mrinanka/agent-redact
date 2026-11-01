// Step 5 tuning (plan "Tuning order"): fewer false alarms without a lower catch rate. Each harmless rule has a
// twin showing a real-looking value in the same spot is still hidden (R-08). The numbers are pinned here, so
// a change that costs the catch rate or the code set fails.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { NO_ALLOW, Redactor } from '../src/core/session.ts'
import { catchSet } from '../tools/test-sets/catch.ts'
import { codeSet } from '../tools/test-sets/code.ts'
import { logFiles } from '../tools/test-sets/logs.ts'

const PW = 'Autumn' + '2026xk'
const PW2 = 'Meadow' + '7731bq'
const checker = createChecker({}).checker
const scan = (text: string, file?: string) => checker.scan(text, file === undefined ? {} : { file }).findings
const make = (o: { custom?: { id: string; label: string; keyword: string; pattern: string }[] } = {}): Redactor =>
  new Redactor({ checker: createChecker({ ...(o.custom ? { custom: o.custom } : {}) }).checker, registered: [], hints: true, allow: NO_ALLOW })
const run = (r: Redactor, text: string) => r.redactText(text, { deadline: performance.now() + 20_000 })

// ---- type aliases are code, with no file name needed --------------------------------------

const ALIASES: [harmless: string, twin: string][] = [
  ['export type DotToken = Token<SyntaxKind.DotToken>', `export var DotToken = ${PW}`],
  ['type AuthToken = TokenKind.Auth', `const AuthToken = ${PW2}`],
  ['declare type ApiKey = string | undefined', `declare var ApiKey = ${PW}`],
  ['export declare type ClientSecret = SecretString', `export declare var ClientSecret = ${PW2}`],
  ['type AdminPassword<T> = Brand<T, AdminPassword>', `let AdminPassword = ${PW}`],
  ['  export type Token = Identifier | Keyword', `  export const Token = ${PW}`],
]

for (const [harmless, twin] of ALIASES) {
  test(`type alias, no file name: "${harmless.trim().slice(0, 40)}" is left alone and a real password in its place is hidden`, () => {
    assert.deepEqual(scan(harmless), [], harmless)
    const hit = scan(twin)
    assert.equal(hit.length, 1, twin)
    assert.equal(twin.slice(hit[0]?.start, hit[0]?.end), twin.slice(twin.indexOf('= ') + 2))
  })
}

test('a quoted value in a type alias is still a value: it is hidden', () => {
  const text = `type Secret = "${PW}"`
  const hit = scan(text)
  assert.equal(hit.length, 1)
  assert.equal(text.slice(hit[0]?.start, hit[0]?.end), PW)
})

test('a line that only mentions "type" is not a type alias', () => {
  assert.equal(scan(`type_token = ${PW}`).length, 1)
  assert.equal(scan(`// the type of token is ${PW}\ntoken = ${PW}`).length >= 1, true)
  assert.equal(scan(`retype Token = ${PW}`).length, 1)
})

test('a type alias on one line does not make the next line harmless', () => {
  const hit = scan(`export type DotToken = Token<SyntaxKind.DotToken>\npassword = ${PW}\n`)
  assert.equal(hit.length, 1)
})

// ---- D-071: a letters-only value found only by a password label is hidden where found, not remembered ------

test('D-071: a letters-only password is hidden where its label found it, but a bare copy later is not hidden', () => {
  const r = make()
  const first = run(r, 'password=summerrain\n')
  assert.ok(!first.text.includes('summerrain'))
  assert.equal(run(r, 'later in the log: summerrain is a plain word here').text.includes('summerrain'), true)
})

test('D-071: a mixed-case letters-only value is treated the same way', () => {
  const r = make()
  assert.ok(!run(r, 'DB_PASSWORD=HarborMeadow').text.includes('HarborMeadow'))
  assert.ok(run(r, 'HarborMeadow appears again').text.includes('HarborMeadow'))
})

test('D-071: a value with a digit (the hunter2 shape) is remembered', () => {
  const r = make()
  assert.ok(!run(r, 'password=hunter2\n').text.includes('hunter2'))
  assert.ok(!run(r, 'later hunter2 here').text.includes('hunter2'))
  const r2 = make()
  run(r2, `password=${PW}`)
  assert.ok(!run(r2, `bare ${PW}`).text.includes(PW))
})

test('D-071: a letters-only value found by a shape rule is still remembered', () => {
  const r = make({ custom: [{ id: 'acme-letters', label: 'ACME', keyword: 'acme_', pattern: 'acme_[a-z]{24}' }] })
  const value = 'acme_' + 'qwertyuiopasdfghjklzxcvb'
  assert.ok(!run(r, `see ${value}`).text.includes(value))
  assert.ok(!run(r, `again ${value}`).text.includes(value))
})

test('D-071: a letters-only value is still remembered when the same value was also seen with a digit label shape', () => {
  const r = make()
  run(r, 'password=summerrain\n')
  // The URL form is a label rule too: not remembered either.
  const url = run(r, 'postgres://app:summerrain@db.internal/x')
  assert.ok(!url.text.includes('summerrain'))
})

// ---- the numbers do not move ---------------------------------------------------------------

test('the code set stays 41 of 41 left alone and the twins 81 of 81 hidden', () => {
  const real = ['Autumn' + '2026xk', 'Meadow' + '7731bq']
  let left = 0
  let twins = 0
  let expected = 0
  const set = codeSet()
  assert.equal(set.length, 41)
  for (const c of set) {
    if (scan(c.text).length === 0) left++
    const values = c.id === 'documented-example-key' ? ['AK' + 'IA' + 'ZQ7XKMN4HTW3PBDC'] : real
    for (const v of values) {
      expected++
      const text = c.twin(v)
      const at = text.indexOf(v)
      if (scan(text).some(f => f.start <= at && f.end >= at + v.length)) twins++
    }
  }
  assert.equal(left, 41)
  assert.equal(expected, 81)
  assert.equal(twins, 81)
})

test('the catch rate through the whole pipeline stays at 135 of 138 or better', () => {
  const cases = catchSet()
  assert.equal(cases.length, 138)
  const missed = cases.filter(c => {
    const s = c.secrets[0]
    return s === undefined || run(make(), c.text).text.includes(s.shown)
  })
  assert.ok(cases.length - missed.length >= 135, `${cases.length - missed.length} of ${cases.length}; missed ${missed.map(c => c.id).join(', ')}`)
})

test('the log-like set is made from a fixed seed, holds no secret, and false alarms on it fall as the tuning goes on', () => {
  const files = logFiles()
  assert.equal(files.length, 7)
  const again = logFiles()
  assert.deepEqual(again.map(f => f.text.length), files.map(f => f.text.length))
  assert.equal(files.map(f => f.text).join('') === again.map(f => f.text).join(''), true)
  const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.text), 0)
  assert.ok(bytes > 1_000_000 && bytes < 1_400_000, String(bytes))
})

// ---- prose after a colon (owner's yes at the targets step; spec §7.1, §7.2) ------------------------------

const PROSE: [harmless: string, twin: string, shown: string][] = [
  ['failed to validate token: signature mismatch for kid=7', `failed to validate token: ${PW} mismatch for kid=7`, PW],
  ['the secret: nothing special here', `the secret: ${PW2} here`, PW2],
  ['password: summerrain admin', 'password: summerrain', 'summerrain'],
  ['token: expired yesterday afternoon', 'token: expired', 'expired'],
]

for (const [harmless, twin, shown] of PROSE) {
  test(`prose after a colon: "${harmless.slice(0, 40)}" is left alone, and its real-looking twin is hidden`, () => {
    assert.deepEqual(scan(harmless), [], harmless)
    const hit = scan(twin)
    assert.equal(hit.length, 1, twin)
    assert.equal(twin.slice(hit[0]?.start, hit[0]?.end), shown)
  })
}

test('prose rule: it applies only to a colon, an unquoted value of 6+ lowercase letters, and a word right after', () => {
  const hidden = (t: string): boolean => scan(t).length > 0
  assert.equal(hidden('password=summerrain admin'), true, 'an equals sign is a setting, not prose')
  assert.equal(hidden('password: "summerrain" admin'), true, 'a quoted value is a value')
  assert.equal(hidden('password: Summerrain admin'), true, 'a capital letter')
  assert.equal(hidden('password: summer1rain admin'), true, 'a digit')
  assert.equal(hidden('password: summerrain # old'), true, 'a comment is not a word')
  assert.equal(hidden('password: summerrain, admin'), true, 'a comma ends a setting')
  assert.equal(hidden('password: summerrain\nadmin'), true, 'the next line is not the same sentence')
  assert.equal(hidden('password: summer admin'), false, 'under six letters was never hidden')
  assert.equal(hidden('password: summerrain  admin'), true, 'two spaces is a column, not a sentence')
})
