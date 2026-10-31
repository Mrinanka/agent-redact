// The catch set (plan 1b): realistic fake secrets in many places. Step 2 measures
// how much the checker finds. A fixed seed gives the same fakes each run, so
// catch rates compare between releases; nothing here is stored in the repo.

import { FAKE_KINDS, humanWord, makeFake, pick, seededSource, type Fake, type FakeKind, type Source } from './fakes.ts'

export const CATCH_CONTEXTS = [
  'env',
  'env-crlf',
  'json',
  'yaml',
  'log',
  'log-unicode',
  'url',
  'stack-trace',
  'escaped-json',
  'base64',
] as const

export type CatchContext = (typeof CATCH_CONTEXTS)[number]

export type Encoding = 'plain' | 'base64' | 'json-escaped' | 'json-escaped-twice' | 'url'

export type CatchSecret = {
  value: string
  /** The secret as it appears in `text`. */
  shown: string
  encoding: Encoding
  start: number
  end: number
}

export type CatchCase = {
  id: string
  format: FakeKind | 'human-password'
  context: CatchContext
  text: string
  secrets: CatchSecret[]
}

const jsonEscape = (s: string): string => JSON.stringify(s).slice(1, -1)

type Shape = { before: string; after: string; show: (value: string) => string; encoding: Encoding }

const asIs = (s: string): string => s

function shape(context: CatchContext): Shape {
  switch (context) {
    case 'env':
      return { before: 'APP_ENV=production\nSERVICE_KEY=', after: '\nLOG_LEVEL=info\n', show: asIs, encoding: 'plain' }
    case 'env-crlf':
      return { before: 'APP_ENV=production\r\nSERVICE_KEY=', after: '\r\nLOG_LEVEL=info\r\n', show: asIs, encoding: 'plain' }
    case 'json':
      return { before: '{\n  "service": "billing",\n  "credential": "', after: '",\n  "retries": 3\n}\n', show: jsonEscape, encoding: 'json-escaped' }
    case 'yaml':
      return { before: 'service: billing\nauth:\n  credential: ', after: '\n  retries: 3\n', show: asIs, encoding: 'plain' }
    case 'log':
      return { before: '2026-10-31T12:00:00.123Z INFO  [worker-3] connecting with ', after: ' after 2 retries\n', show: asIs, encoding: 'plain' }
    case 'log-unicode':
      return { before: '2026-10-31 — connexion établie ✓ 接続 ', after: ' — terminé\n', show: asIs, encoding: 'plain' }
    case 'url':
      return { before: 'GET https://api.example.test/v1/items?limit=10&access=', after: '&page=2 HTTP/1.1\n', show: encodeURIComponent, encoding: 'url' }
    case 'stack-trace':
      return {
        before: 'Error: connect failed\n    at Client.connect (/srv/app/db.js:42:11)\n    at options: { credential: \'',
        after: '\' }\n    at main (/srv/app/index.js:7:3)\n',
        show: asIs,
        encoding: 'plain',
      }
    case 'escaped-json':
      return { before: '{"payload":"{\\"credential\\":\\"', after: '\\"}"}\n', show: s => jsonEscape(jsonEscape(s)), encoding: 'json-escaped-twice' }
    case 'base64':
      return { before: 'blob=', after: '\n', show: s => Buffer.from(s, 'utf8').toString('base64'), encoding: 'base64' }
  }
}

function buildCase(id: string, format: CatchCase['format'], context: CatchContext, fake: Pick<Fake, 'value' | 'text'>): CatchCase {
  const s = shape(context)
  const shown = s.show(fake.value)
  // A wrapper (a connection string, a label) stays in the clear, unless the whole context encodes it.
  const at = fake.text.indexOf(fake.value)
  const wrapBefore = context === 'base64' ? '' : s.show(fake.text.slice(0, at))
  const wrapAfter = context === 'base64' ? '' : s.show(fake.text.slice(at + fake.value.length))
  const head = s.before + wrapBefore
  const text = head + shown + wrapAfter + s.after
  return {
    id,
    format,
    context,
    text,
    secrets: [{ value: fake.value, shown, encoding: shown === fake.value ? 'plain' : s.encoding, start: head.length, end: head.length + shown.length }],
  }
}

const HUMAN_LABELS: [string, string][] = [
  ['password=', '\n'],
  ['pw: ', '\n'],
  ['DB_PASSWORD="', '"\n'],
  ['Server=db.internal;User Id=app;Password=', ';Encrypt=true\n'],
  ['smtpPass = ', '\n'],
  ['client-secret: ', '\n'],
  ['pwd=', '\n'],
  ["secret = '", "'\n"],
]

function humanCases(src: Source): CatchCase[] {
  return HUMAN_LABELS.map(([before, after], i) => {
    const value = `${humanWord(src)}${pick(src, '0123456789', 1 + (i % 4))}`
    const text = `# config\n${before}${value}${after}`
    const start = text.indexOf(value)
    return {
      id: `human-password/env/${i}`,
      format: 'human-password' as const,
      context: 'env' as const,
      text,
      secrets: [{ value, shown: value, encoding: 'plain' as const, start, end: start + value.length }],
    }
  })
}

export function catchSet(seed = 'catch-set-v1'): CatchCase[] {
  const src = seededSource(seed)
  const cases: CatchCase[] = []
  for (const kind of FAKE_KINDS) {
    for (const context of CATCH_CONTEXTS) {
      cases.push(buildCase(`${kind}/${context}`, kind, context, makeFake(kind, src)))
    }
  }
  return [...cases, ...humanCases(src)]
}
