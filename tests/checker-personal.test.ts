// personal_data (spec §14, D-037): email addresses and phone numbers, off by default. Every harmless form
// has a twin test showing a real-looking value in the same spot is hidden (R-08). No hints are shown.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { codeSet } from '../tools/test-sets/code.ts'
import { catchSet } from '../tools/test-sets/catch.ts'

const on = createChecker({ personalData: true }).checker
const off = createChecker({}).checker
const found = (text: string, c = on): { text: string; rule: string }[] => {
  const r = c.scan(text, { budgetMs: 5000 })
  c.clearLines()
  return r.findings.map(f => ({ text: text.slice(f.start, f.end), rule: f.ruleId }))
}
const hidden = (text: string): string[] => found(text).map(f => f.text)

// ---- email --------------------------------------------------------------------------------

test('an ordinary address is found as a whole, with its rule id, and no hint is allowed', () => {
  const r = on.scan('write to Jane.Doe+news@Sub.Acme-Corp.co.uk today', { budgetMs: 5000 })
  assert.equal(r.findings.length, 1)
  const f = r.findings[0]
  assert.equal('write to Jane.Doe+news@Sub.Acme-Corp.co.uk today'.slice(f?.start, f?.end), 'Jane.Doe+news@Sub.Acme-Corp.co.uk')
  assert.equal(f?.ruleId, 'personal-email')
  assert.equal(f?.label, 'EMAIL')
  assert.equal(f?.showHint, false)
  assert.equal(f?.action, 'hide')
})

test('an address in angle brackets, quotes, JSON and at the end of a sentence loses no neighbour characters', () => {
  assert.deepEqual(hidden('<bob@acme-mail.com>'), ['bob@acme-mail.com'])
  assert.deepEqual(hidden('"to": "bob@acme-mail.com",'), ['bob@acme-mail.com'])
  assert.deepEqual(hidden('Mail bob@acme-mail.com.'), ['bob@acme-mail.com'])
  assert.deepEqual(hidden('a@b.io, c@d.org; e@f.net'), ['a@b.io', 'c@d.org', 'e@f.net'])
})

test('off by default, and off when the rule is turned off', () => {
  assert.deepEqual(found('bob@acme-mail.com +44 20 7946 0958', off), [])
  const noEmail = createChecker({ personalData: true, off: ['personal-email'] }).checker
  assert.deepEqual(found('bob@acme-mail.com and 415-555-0132', noEmail).map(f => f.rule), ['personal-phone'])
  const noPhone = createChecker({ personalData: true, off: ['personal-phone'] }).checker
  assert.deepEqual(found('bob@acme-mail.com and 415-555-0132', noPhone).map(f => f.rule), ['personal-email'])
})

test('rules.actions works: warn and block', () => {
  const warn = createChecker({ personalData: true, actions: { 'personal-email': 'warn' } }).checker
  assert.equal(warn.scan('bob@acme-mail.com').findings[0]?.action, 'warn')
  const block = createChecker({ personalData: true, actions: { 'personal-phone': 'block' } }).checker
  assert.equal(block.scan('call +44 20 7946 0958').findings[0]?.action, 'block')
})

const EMAIL_PAIRS: [name: string, harmless: string, twin: string, value: string][] = [
  ['example domains', 'contact: jane@example.com', 'contact: jane@acme-mail.com', 'jane@acme-mail.com'],
  ['example subdomain', 'cc: ops@mail.example.org', 'cc: ops@mail.acme-mail.org', 'ops@mail.acme-mail.org'],
  ['.test', 'user: sam@shop.test', 'user: sam@shop.dev', 'sam@shop.dev'],
  ['.invalid', 'from: nobody@mail.invalid', 'from: nobody@mail.info', 'nobody@mail.info'],
  ['.local', 'host admin@printer.local', 'host admin@printer.work', 'admin@printer.work'],
  ['an SSH remote', 'git clone git@github.com:acme/app.git', 'git clone git@github.com and mail pat@acme-mail.com', 'pat@acme-mail.com'],
  ['an scp path', 'scp deploy@build-host.dev:/srv/app/x .', 'scp x deploy@build-host.dev please', 'deploy@build-host.dev'],
  ['an image at 2x', "<img src='logo@2x.png'>", "<img alt='lee@acme-mail.com'>", 'lee@acme-mail.com'],
  ['a package version', 'npm i pkg@1.2.3 lodash@4.17.21', 'npm i pkg and mail kim@acme-mail.com', 'kim@acme-mail.com'],
  ['a scoped package', 'import x from "@types/node"', 'import x from "kim@acme-mail.com"', 'kim@acme-mail.com'],
  ['a name with no dot in the domain', 'ssh me@box', 'ssh me@box.net', 'me@box.net'],
  ['an IP address', 'login root@10.0.0.1', 'login root@box.net', 'root@box.net'],
  ['a decorator or mention', 'thanks @alice and @bob', 'thanks alice@acme-mail.com', 'alice@acme-mail.com'],
]

for (const [name, harmless, twin, value] of EMAIL_PAIRS) {
  test(`email, ${name}: the harmless form is left alone and a real-looking address in its place is hidden`, () => {
    assert.deepEqual(hidden(harmless), [], harmless)
    assert.deepEqual(hidden(twin), [value], twin)
  })
}

test('email edge cases: no local part, double dots, very long runs and lone @ signs never crash', () => {
  for (const text of ['@', '@@@@', 'a@', '@b.com', 'a@.com', 'a@b..com', 'a@-b.com', `${'a'.repeat(200)}@b.com`, `a@${'b'.repeat(300)}.com`, `a@${'b.'.repeat(500)}com`, '@'.repeat(100_000)]) {
    assert.doesNotThrow(() => found(text), text.slice(0, 20))
  }
  assert.deepEqual(hidden('a@b..com'), [])
})

// ---- phone --------------------------------------------------------------------------------

test('international numbers need a + and 8 to 15 digits, with spaces, dots, dashes and brackets allowed', () => {
  assert.deepEqual(hidden('call +44 20 7946 0958 now'), ['+44 20 7946 0958'])
  assert.deepEqual(hidden('call +1 (415) 555-0132.'), ['+1 (415) 555-0132'])
  assert.deepEqual(hidden('call +14155550132, ok'), ['+14155550132'])
  assert.deepEqual(hidden('+81-3-1234-5678'), ['+81-3-1234-5678'])
  assert.equal(found('+44 20 7946 0958')[0]?.rule, 'personal-phone')
  assert.equal(on.scan('+44 20 7946 0958').findings[0]?.showHint, false)
})

test('national numbers need separators in the usual shapes', () => {
  assert.deepEqual(hidden('tel 415-555-0132'), ['415-555-0132'])
  assert.deepEqual(hidden('tel (415) 555-0132'), ['(415) 555-0132'])
  assert.deepEqual(hidden('tel 415.555.0132'), ['415.555.0132'])
  assert.deepEqual(hidden('tel 1-800-555-0100'), ['1-800-555-0100'])
})

const PHONE_PAIRS: [name: string, harmless: string, twin: string, value: string][] = [
  ['a bare digit run', 'order 4155550132 shipped', 'order 415-555-0132 shipped', '415-555-0132'],
  ['a unix timestamp', 'created 1698765432 and 1698765432123', 'created +1 698 765 4321', '+1 698 765 4321'],
  ['a date and time', 'at 2026-11-01 12:30:45', 'at 415-555-0132 12:30:45', '415-555-0132'],
  ['a version number', 'Windows 10.0.19045.3693 and v1.2.3', 'Windows 415.555.0132 and v1.2.3', '415.555.0132'],
  ['an IP address', 'ip 192.168.100.200 and 10.0.0.1', 'ip 415.555.0132 and 10.0.0.1', '415.555.0132'],
  ['a UUID', 'id 550e8400-e29b-41d4-a716-446655440000', 'id 550e8400 call 415-555-0132', '415-555-0132'],
  ['a number with thousands separators', 'total 1,234,567,890', 'total 415-555-0132', '415-555-0132'],
  ['a number with a plus inside an expression', 'x=1+4155550132 and a+44207946', 'x=1 and +44 20 7946 0958', '+44 20 7946 0958'],
  ['a long hex id', 'sha 4155550132abcdef0123', 'sha abcdef0123 +1 415 555 0132', '+1 415 555 0132'],
  ['a short plus number', 'range +12 to +3456', 'range +12 call +44 20 7946 0958', '+44 20 7946 0958'],
]

for (const [name, harmless, twin, value] of PHONE_PAIRS) {
  test(`phone, ${name}: the harmless form is left alone and a real-looking number in its place is hidden`, () => {
    assert.deepEqual(hidden(harmless), [], harmless)
    assert.deepEqual(hidden(twin), [value], twin)
  })
}

test('phone edge cases never crash or stall', () => {
  const started = performance.now()
  for (const text of ['+', '+'.repeat(100_000), `+${'1 '.repeat(50_000)}`, `(${'1'.repeat(100_000)})`, '-'.repeat(100_000), `415-555-${'0'.repeat(100_000)}`]) {
    assert.doesNotThrow(() => found(text), text.slice(0, 20))
  }
  assert.ok(performance.now() - started < 5000)
})

// ---- the rest of the checker is untouched ------------------------------------------------

test('off by default means the code set and the catch set are exactly as before', () => {
  for (const c of codeSet()) assert.equal(off.scan(c.text).findings.length, 0, c.id)
  const n = (checker: typeof on): number => catchSet().filter(c => checker.scan(c.text).findings.length > 0).length
  assert.equal(n(off), n(createChecker({}).checker))
})

test('turned on, the code set is still left alone', () => {
  for (const c of codeSet()) {
    const hits = found(c.text).filter(f => f.rule.startsWith('personal-'))
    assert.deepEqual(hits, [], c.id)
    on.clearLines()
  }
})

test('an email next to a password label: the password is still found whole', () => {
  const r = found('user=bob@acme-mail.com password=Autumn2026xk')
  assert.ok(r.some(f => f.rule === 'personal-email'))
  assert.ok(r.some(f => f.rule === 'password-label' && f.text === 'Autumn2026xk'))
})
