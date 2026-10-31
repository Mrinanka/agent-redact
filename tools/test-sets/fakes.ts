// Fake secrets, built at run time from pieces, so no whole fake is ever in the
// repo and GitHub secret scanning has nothing to flag (CLAUDE.md, spec §21).
// Key formats as read in Gitleaks v8.30.1; nothing is copied from it.
//
// A source of bytes decides the fake: random for the leak test kit (a new value
// each run), seeded for the test sets (the same values each run, so scores can
// be compared between releases).

import { createHash, randomBytes } from 'node:crypto'

export const FAKE_KINDS = [
  'github-pat',
  'gitlab-pat',
  'aws-access-key',
  'slack-bot',
  'stripe',
  'databricks',
  'gcp',
  'npm',
  'azure-ad',
  'jfrog',
  'private-key',
  'connection-string',
  'labelled-password',
] as const

export type FakeKind = (typeof FAKE_KINDS)[number]

export type Fake = {
  kind: FakeKind
  /** The secret itself: what must not reach the model. */
  value: string
  /** The value as it would appear in the wild, with any context its format needs. */
  text: string
}

export type PlantForm = 'plain' | 'base64' | 'json-escaped' | 'url'

export type Source = (n: number) => Uint8Array

export const randomSource = (): Source => n => randomBytes(n)

export function seededSource(seed: string): Source {
  let counter = 0
  let held: Buffer = Buffer.alloc(0)
  return n => {
    const chunks: Buffer[] = [held]
    let have = held.length
    while (have < n) {
      const block = createHash('sha256').update(`${seed}:${counter}`).digest()
      counter += 1
      chunks.push(block)
      have += block.length
    }
    const all = Buffer.concat(chunks)
    held = all.subarray(n)
    return all.subarray(0, n)
  }
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const ALNUM = DIGITS + UPPER + LOWER
const LOWER_ALNUM = LOWER + DIGITS
const WORD = ALNUM + '_-'
const BASE32 = UPPER + '234567'
const HEX = '0123456789abcdef'
const AZURE_START = ALNUM + '_~.'
const AZURE_REST = AZURE_START + '-'
const BASE64 = ALNUM + '+/'

export function pick(src: Source, alphabet: string, n: number): string {
  const bytes = src(n)
  let out = ''
  for (let i = 0; i < n; i++) out += alphabet[(bytes[i] ?? 0) % alphabet.length]
  return out
}

/** Decimal digits that never start with 0. */
const number = (src: Source, n: number): string => pick(src, '123456789', 1) + pick(src, DIGITS, n - 1)

const WORDS = ['Autumn', 'Summer', 'Winter', 'Spring', 'Harbor', 'Meadow', 'Silver', 'Copper']

export function humanWord(src: Source): string {
  return WORDS[(src(1)[0] ?? 0) % WORDS.length] ?? 'Autumn'
}

function privateKey(src: Source): string {
  const lines = [0, 1, 2, 3].map(() => pick(src, BASE64, 64))
  return [['-----BEGIN', 'RSA PRIVATE', 'KEY-----'].join(' '), ...lines, ['-----END', 'RSA PRIVATE', 'KEY-----'].join(' ')].join('\n')
}

export function makeFake(kind: FakeKind, src: Source): Fake {
  const plain = (value: string): Fake => ({ kind, value, text: value })
  switch (kind) {
    case 'github-pat':
      return plain(['ghp', pick(src, ALNUM, 36)].join('_'))
    case 'gitlab-pat':
      return plain(['glpat', pick(src, WORD, 20)].join('-'))
    case 'aws-access-key':
      return plain('AK' + 'IA' + pick(src, BASE32, 16))
    case 'slack-bot':
      return plain(['xoxb', number(src, 11), number(src, 12), pick(src, ALNUM, 24)].join('-'))
    case 'stripe':
      return plain(['sk', 'test', pick(src, ALNUM, 24)].join('_'))
    case 'databricks':
      return plain('da' + 'pi' + pick(src, HEX, 32))
    case 'gcp':
      return plain('AI' + 'za' + pick(src, WORD, 35))
    case 'npm':
      return plain(['npm', pick(src, LOWER_ALNUM, 36)].join('_'))
    case 'azure-ad':
      return plain(`${pick(src, AZURE_START, 3)}${pick(src, DIGITS, 1)}Q~${pick(src, AZURE_REST, 34)}`)
    case 'jfrog': {
      const value = pick(src, LOWER_ALNUM, 73)
      return { kind, value, text: `artifactory_api_key=${value}` }
    }
    case 'private-key':
      return plain(privateKey(src))
    case 'connection-string': {
      const value = pick(src, ALNUM, 16)
      return { kind, value, text: `postgres://app:${value}@db.internal:5432/app` }
    }
    case 'labelled-password': {
      const value = `${humanWord(src)}${number(src, 4)}${pick(src, LOWER, 4)}`
      return { kind, value, text: `password=${value}` }
    }
  }
}

/** A harmless random token planted next to fakes, to prove a door was really used. */
export const makeWitness = (src: Source): string => `witness-${pick(src, HEX, 16)}`

/** How a fake is written into a file, prompt or tool result. One line, except a plain private key. */
export function plant(fake: Fake, form: PlantForm): string {
  switch (form) {
    case 'plain':
      return fake.text
    case 'base64':
      return `b64: ${Buffer.from(fake.value, 'utf8').toString('base64')}`
    case 'json-escaped':
      return JSON.stringify({ key: fake.value })
    case 'url':
      return `https://example.test/login?p=${encodeURIComponent(fake.value)}`
  }
}
