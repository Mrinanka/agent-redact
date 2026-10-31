// Fake secret generators (tools/test-sets/fakes.ts). Every fake is built at run
// time from pieces, so no whole fake is ever written in the repo. The shapes
// below are the key formats as read in Gitleaks v8.30.1 (nothing copied): if a
// fake drifts from its format, the catch set stops measuring anything.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FAKE_KINDS, makeFake, makeWitness, plant, randomSource, seededSource, type FakeKind } from '../tools/test-sets/fakes.ts'

const SHAPES: Record<FakeKind, RegExp> = {
  'github-pat': /^ghp_[0-9a-zA-Z]{36}$/,
  'gitlab-pat': /^glpat-[\w-]{20}$/,
  'aws-access-key': /^AKIA[A-Z2-7]{16}$/,
  'slack-bot': /^xoxb-\d{10,13}-\d{10,13}-[a-zA-Z0-9]{24}$/,
  'stripe': /^sk_test_[a-zA-Z0-9]{24}$/,
  'databricks': /^dapi[a-f0-9]{32}$/,
  'gcp': /^AIza[\w-]{35}$/,
  'npm': /^npm_[a-z0-9]{36}$/,
  'azure-ad': /^[a-zA-Z0-9_~.]{3}\dQ~[a-zA-Z0-9_~.-]{34}$/,
  'jfrog': /^[a-z0-9]{73}$/,
  'private-key': /^-----BEGIN RSA PRIVATE KEY-----\n[A-Za-z0-9+/\n]{64,}\n-----END RSA PRIVATE KEY-----$/,
  'connection-string': /^[A-Za-z0-9]{16}$/,
  'labelled-password': /^[A-Z][a-z]+\d{4}[a-z]{4}$/,
}

test('every kind has a shape and every fake matches it', () => {
  assert.deepEqual([...FAKE_KINDS].sort(), Object.keys(SHAPES).sort())
  const src = randomSource()
  for (const kind of FAKE_KINDS) {
    for (let i = 0; i < 25; i++) {
      const f = makeFake(kind, src)
      assert.match(f.value, SHAPES[kind], kind)
      assert.equal(f.kind, kind)
      assert.ok(f.text.includes(f.value), `${kind}: the text holds the value`)
    }
  }
})

test('the text puts a value where its format needs context', () => {
  const src = randomSource()
  assert.match(makeFake('connection-string', src).text, /^postgres:\/\/app:.+@db\.internal:5432\/app$/)
  assert.match(makeFake('labelled-password', src).text, /^password=/)
  assert.match(makeFake('jfrog', src).text, /^artifactory_api_key=/)
})

test('a random source gives a different value every time', () => {
  const src = randomSource()
  const values = new Set<string>()
  for (let i = 0; i < 500; i++) values.add(makeFake('github-pat', src).value)
  assert.equal(values.size, 500)
})

test('a seeded source gives the same values for the same seed, and others for another', () => {
  const a = seededSource('catch-v1')
  const b = seededSource('catch-v1')
  const c = seededSource('catch-v2')
  const take = (s: typeof a) => FAKE_KINDS.map(k => makeFake(k, s).value)
  const first = take(a)
  assert.deepEqual(first, take(b))
  assert.notDeepEqual(first, take(c))
})

test('a seeded source keeps giving new bytes past one hash block', () => {
  const src = seededSource('long')
  const bytes = src(1000)
  assert.equal(bytes.length, 1000)
  assert.ok(new Set(bytes).size > 200)
})

test('a witness is harmless: it matches no fake shape', () => {
  const src = randomSource()
  const w = makeWitness(src)
  assert.match(w, /^witness-[0-9a-f]{16}$/)
  for (const shape of Object.values(SHAPES)) assert.doesNotMatch(w, shape)
})

test('plant: plain keeps the text; encoded forms hold the value, not in the clear', () => {
  const f = makeFake('stripe', randomSource())
  assert.equal(plant(f, 'plain'), f.text)
  const b64 = plant(f, 'base64')
  assert.ok(!b64.includes(f.value))
  assert.ok(Buffer.from(b64.replace(/^\S+ /, ''), 'base64').toString('utf8') === f.value)
  const url = plant(makeFake('labelled-password', randomSource()), 'url')
  assert.match(url, /^https:\/\/example\.test\/login\?p=/)
})

test('plant: json-escaped survives a parse, including the newlines of a private key', () => {
  const f = makeFake('private-key', randomSource())
  const line = plant(f, 'json-escaped')
  assert.ok(!line.includes('\n'), 'one line')
  assert.equal(JSON.parse(line).key, f.value)
})
