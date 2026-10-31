// The speed set (plan 1c): inputs for timing the checker, including ones designed
// to slow patterns down. Text is built when asked for, from a fixed seed, so each
// run times the same bytes. Nothing here is stored in the repo.

import { RULES } from '../../src/checker/rules.generated.ts'
import { FAKE_KINDS, makeFake, seededSource, type FakeKind } from './fakes.ts'

export type SpeedItem = {
  id: string
  text: () => string
  /** A secret hidden in the text, for items that hold one in an encoded form. */
  secret?: string
  /** Secrets to register before timing. */
  registered?: string[]
}

const KIB = 1024
const MIB = 1024 * KIB

function logLines(size: number, seed: string): string {
  const src = seededSource(seed)
  const parts: string[] = []
  let have = 0
  for (let i = 0; have < size; i++) {
    const line = i % 200 === 199
      ? `2026-10-31T12:00:00.000Z WARN  [worker-${i % 8}] retry with ${makeFake('github-pat', src).text}\n`
      : `2026-10-31T12:00:00.000Z INFO  [worker-${i % 8}] request id=${i} status=200 took=${i % 97}ms path=/api/v1/items/${i}\n`
    parts.push(line)
    have += line.length
  }
  return parts.join('').slice(0, size)
}

function oneLineJson(size: number, seed: string): string {
  const src = seededSource(seed)
  const head = '{"items":['
  const tail = '],"end":"'
  const close = '"}'
  const parts: string[] = []
  let have = head.length + tail.length + close.length
  for (let i = 0; ; i++) {
    const item = JSON.stringify({ id: i, name: `item-${i}`, owner: 'team-a', token: i % 500 === 499 ? makeFake('npm', src).value : null }) + ','
    if (have + item.length > size) break
    parts.push(item)
    have += item.length
  }
  return head + parts.join('') + tail + 'x'.repeat(size - have) + close
}

function base64Block(size: number, secret: string, seed: string): string {
  const rawSize = (size / 4) * 3
  const filler = Buffer.from(seededSource(seed)(1024))
  const raw = Buffer.alloc(rawSize)
  for (let at = 0; at < rawSize; at += filler.length) filler.copy(raw, at)
  raw.write(secret, Math.floor(rawSize / 2), 'latin1')
  return raw.toString('base64')
}

function registered(count: number, seed: string): string[] {
  const src = seededSource(seed)
  const kinds: FakeKind[] = FAKE_KINDS.filter(k => k !== 'private-key')
  const out = new Set<string>()
  for (let i = 0; out.size < count; i++) out.add(makeFake(kinds[i % kinds.length] ?? 'github-pat', src).value)
  return [...out]
}

const repeatTo = (unit: string, size: number): string => unit.repeat(Math.ceil(size / unit.length)).slice(0, size)

function memo(build: () => string): () => string {
  let held: string | undefined
  return () => (held ??= build())
}

const BEGIN_KEY = ['-----BEGIN', 'RSA PRIVATE', 'KEY-----'].join(' ')

export function speedSet(): SpeedItem[] {
  const hidden = makeFake('github-pat', seededSource('speed-base64-secret')).value
  const secrets = registered(10_000, 'speed-registered')
  return [
    { id: 'short', text: () => 'Please fix the login bug in auth.ts and add a test.' },
    { id: 'log-100k', text: memo(() => logLines(100 * KIB, 'speed-log-100k')) },
    { id: 'log-2m', text: memo(() => logLines(2 * MIB, 'speed-log-2m')) },
    { id: 'json-one-line-2m', text: memo(() => oneLineJson(2 * MIB, 'speed-json')) },
    { id: 'base64-block-2m', secret: hidden, text: memo(() => base64Block(2 * MIB, hidden, 'speed-base64')) },
    { id: 'registered-10k', registered: secrets, text: memo(() => `start ${secrets[0]} middle ${secrets[5_000]} end ${secrets[9_999]}\n`) },
    { id: 'adversarial-repeat-char', text: memo(() => 'a'.repeat(MIB)) },
    { id: 'adversarial-keyword-flood', text: memo(() => repeatTo('password=', MIB)) },
    { id: 'adversarial-unclosed-quote', text: memo(() => `password="${'a'.repeat(MIB)}`) },
    { id: 'adversarial-spaces-before-separator', text: memo(() => `token${' '.repeat(MIB)}`) },
    { id: 'adversarial-key-with-no-end', text: memo(() => `${BEGIN_KEY}\n${repeatTo('A', MIB)}`) },
    { id: 'adversarial-near-miss-keys', text: memo(() => repeatTo(`${'AK' + 'IA'}AAAAAAAAAAAAAAA! `, MIB)) },
    // Every rule keyword in turn, so every rule has hits everywhere (step 2).
    { id: 'adversarial-all-keywords', text: memo(() => repeatTo(`${[...new Set(RULES.flatMap(r => r.keywords))].join(' = ')} = `, MIB)) },
    // The words of the rules that span the most text.
    { id: 'adversarial-curl-flood', text: memo(() => repeatTo('curl -H ', 2 * MIB)) },
    { id: 'adversarial-nested-braces', text: memo(() => repeatTo('{{ ${', MIB)) },
  ]
}
