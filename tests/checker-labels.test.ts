// Password labels (spec §7.1), harmless values (§7.2) and the code set (R-08),
// through the whole checker. Fake values are built from pieces at test time.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChecker } from '../src/checker/index.ts'
import { codeSet } from '../tools/test-sets/code.ts'
import { humanWord, pick, seededSource } from '../tools/test-sets/fakes.ts'

const { checker } = createChecker()

const src = seededSource('labels-test')
const value = (n = 4): string => `${humanWord(src)}${pick(src, '0123456789', n)}`

/** The text each finding covers. */
function hidden(text: string, file?: string): string[] {
  const r = checker.scan(text, file === undefined ? {} : { file })
  assert.equal(r.complete, true)
  return r.findings.map(f => text.slice(f.start, f.end))
}

test('strong labels hide a value of 6 or more characters', () => {
  const v = value()
  for (const label of ['password', 'passwd', 'pwd', 'pw', 'pass', 'secret', 'client_secret', 'token', 'api_key', 'apikey', 'private_key', 'conn_str', 'connection_string']) {
    assert.deepEqual(hidden(`${label}=${v}\n`), [v], label)
  }
})

test('a value of 5 characters or fewer is left alone', () => {
  assert.deepEqual(hidden('password=ab123\n'), [])
  assert.deepEqual(hidden('password=abc12\n'), [])
})

test('labels are case-insensitive and may end a name', () => {
  const v = value()
  assert.deepEqual(hidden(`DB_PASSWORD=${v}\n`), [v])
  assert.deepEqual(hidden(`smtpPass = ${v}\n`), [v])
  assert.deepEqual(hidden(`client-secret: ${v}\n`), [v])
  assert.deepEqual(hidden(`PASSWORD: ${v}\n`), [v])
  assert.deepEqual(hidden(`apiKey: ${v}\n`), [v])
  assert.deepEqual(hidden(`my.service.token=${v}\n`), [v])
})

test('every separator works, with optional spaces', () => {
  const v = value()
  for (const sep of ['=', ':', '=>', ':=', ' = ', ' : ', '  =>  ', '\t=\t']) {
    assert.deepEqual(hidden(`password${sep}${v}\n`), [v], JSON.stringify(sep))
  }
})

test('a label without a separator never matches', () => {
  const v = value()
  assert.deepEqual(hidden(`password ${v}\n`), [])
  assert.deepEqual(hidden(`The password must be at least ${v} characters\n`), [])
  assert.deepEqual(hidden('if retry:\n    pass\n'), [])
})

test('"bypass =" and "monkey:" are not labels', () => {
  const v = value()
  assert.deepEqual(hidden(`bypass = ${v}\n`), [])
  assert.deepEqual(hidden(`monkey: ${v}\n`), [])
  assert.deepEqual(hidden(`compass=${v}\n`), [])
  assert.deepEqual(hidden(`passwords=${v}\n`), [])
})

test('"==" is a comparison, not a separator', () => {
  assert.deepEqual(hidden(`if (password == "${value()}") {}\n`), [])
})

test('quoted values: single, double and backtick, hiding the inside only', () => {
  const v = `${value()} with spaces`
  for (const q of ["'", '"', '`']) {
    assert.deepEqual(hidden(`password=${q}${v}${q}\n`), [v], q)
  }
})

test('an unclosed quote runs to the end of the line', () => {
  const v = value()
  assert.deepEqual(hidden(`password="${v}\nnext line\n`), [v])
})

test('unquoted values stop at a space, ;, comma, & or a closing bracket', () => {
  const v = value()
  for (const end of [' tail', ';tail', ',tail', '&tail', ')tail', ']tail', '}tail', '\n', '\r\n', '']) {
    assert.deepEqual(hidden(`password=${v}${end}`), [v], JSON.stringify(end))
  }
})

test('quoted keys, as in JSON, and escaped quotes', () => {
  const v = value()
  assert.deepEqual(hidden(`{"password": "${v}"}`), [v])
  assert.deepEqual(hidden(`{'token':'${v}'}`), [v])
  assert.deepEqual(hidden(`{\\"password\\":\\"${v}\\"}`), [v])
})

test('a connection string hides the Password part only', () => {
  const v = value()
  assert.deepEqual(hidden(`Server=db.internal;User Id=app;Password=${v};Encrypt=true\n`), [v])
})

test('weak labels need a random-looking value', () => {
  const random = pick(src, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 24)
  for (const label of ['key', 'auth', 'credential', 'access']) {
    assert.deepEqual(hidden(`${label}=${random}\n`), [random], label)
    assert.deepEqual(hidden(`${label}=${value()}\n`), [], `${label} with a simple value`)
  }
  assert.deepEqual(hidden('key = value\n'), [])
})

test('label values get no last-4 hint', () => {
  const v = value()
  const r = checker.scan(`password=${v}\n`)
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0]?.kind, 'label')
  assert.equal(r.findings[0]?.showHint, false)
})

test('URL passwords are hidden; URLs without one are not', () => {
  const v = pick(src, 'abcdefghijklmnopqrstuvwxyz0123456789', 16)
  assert.deepEqual(hidden(`postgres://app:${v}@db.internal:5432/app\n`), [v])
  assert.deepEqual(hidden(`https://user:${v}@example.test/path?x=1\n`), [v])
  assert.deepEqual(hidden('postgres://db.internal:5432/app\n'), [])
  assert.deepEqual(hidden('postgres://app@db.internal/app\n'), [])
  assert.deepEqual(hidden('postgres://app:@db.internal/app\n'), [])
  assert.deepEqual(hidden('postgres://app:${DB_PASS}@db.internal/app\n'), [])
  assert.deepEqual(hidden('https://example.test/a@b\n'), [])
})

test('placeholders and variable references are left alone when bare', () => {
  for (const v of ['${DB_PASS}', '$DB_PASS', '%DB_PASS%', '{{ db.pass }}', '${{ secrets.DB_PASS }}', '<password>', '********', 'xxxxxxxx', 'changeme', 'your-password-here']) {
    assert.deepEqual(hidden(`password=${v}\n`), [], v)
  }
})

test('variable references and placeholders are left alone when quoted', () => {
  for (const v of ['${DB_PASS}', '<password>', '********', '{{ db.pass }}', '${{ secrets.DB_PASS }}']) {
    assert.deepEqual(hidden(`password: "${v}"
`), [], v)
  }
})

test('code shapes are left alone when bare', () => {
  for (const v of ['process.env.DB_PASS', 'config.password', 'getPassword()', 'os.environ["X"]', 'ENV["X"]']) {
    assert.deepEqual(hidden(`password=${v}\n`), [], v)
  }
})

test('a quoted value is never treated as code', () => {
  assert.deepEqual(hidden('password = "config.password"\n'), ['config.password'])
  assert.deepEqual(hidden('password = "getToken()"\n'), ['getToken()'])
})

test('a single identifier is code in a source file, a value elsewhere', () => {
  const id = `${humanWord(src)}${pick(src, '0123456789', 4)}`
  assert.deepEqual(hidden(`password = ${id}\n`, 'a.ts'), [])
  assert.deepEqual(hidden(`password = ${id}\n`, 'a.py'), [])
  assert.deepEqual(hidden(`password = ${id}\n`, '.env'), [id])
  assert.deepEqual(hidden(`password = ${id}\n`, 'deploy.sh'), [id])
  assert.deepEqual(hidden(`password = ${id}\n`), [id])
})

test('a value equal to its own label is harmless everywhere', () => {
  assert.deepEqual(hidden('password = password\n'), [])
  assert.deepEqual(hidden('password = password\n', '.env'), [])
  assert.deepEqual(hidden('SECRET=secret\n'), [])
})

test('the same line with a file and with none gives the two agreed results', () => {
  const line = 'const token = getTokenFromStore\n'
  assert.deepEqual(hidden(line, 'a.ts'), [])
  assert.deepEqual(hidden(line), ['getTokenFromStore'])
})

// ---- the code set (R-08) -------------------------------------------------------------

test('code set: every harmless text finds nothing, every twin is hidden', () => {
  const real = [value(5), 'Autumn' + '2026xk', 'Meadow' + '7731bq']
  for (const c of codeSet()) {
    assert.deepEqual(hidden(c.text), [], `${c.id}: should be left alone`)
    const values = c.id === 'documented-example-key' ? ['AK' + 'IA' + 'ZQ7XKMN4HTW3PBDC', 'AK' + 'IA' + 'Q2W3E4R5T6Y7U2I3'] : real
    for (const v of values) {
      const text = c.twin(v)
      const r = checker.scan(text)
      const covered = r.findings.some(f => f.start <= text.indexOf(v) && f.end >= text.indexOf(v) + v.length)
      assert.ok(covered, `${c.id}: the twin with ${v.length} chars should be hidden`)
    }
  }
})
