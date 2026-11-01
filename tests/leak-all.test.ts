// Guards for step 4's "Done when": every door runs in CI, and a door proven by being stopped can't pass
// by accident.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { doorVerdict } from '../tools/leak-test/kit.ts'
import { SCENARIOS, STORE_SCENARIOS } from '../tools/leak-test/scenarios.ts'

const root = path.join(import.meta.dirname, '..')
const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')

test('CI runs every door pinned, on all 3 OSes, with the store door on', () => {
  assert.match(ci, /run: npm run leak-test -- --require-pinned --allow-real-store/)
  assert.match(ci, /dbus-run-session[^\n]*npm run leak-test -- --require-pinned --allow-real-store/)
})

test('only the resume door may pass by being stopped, and the store door stays apart', () => {
  assert.deepEqual(SCENARIOS.filter(s => s.heldMessage).map(s => s.name), ['resume'])
  assert.deepEqual(STORE_SCENARIOS.map(s => s.name), ['registered'])
  assert.ok(!SCENARIOS.some(s => s.seedStore))
})

test('a held door passes only when it was held; a fake seen always fails', () => {
  const none = { witnessSeen: false, fakes: [] }
  assert.equal(doorVerdict(none, 'clean', false, true), 'pass')
  assert.equal(doorVerdict(none, 'clean', false, false), 'invalid')
  assert.equal(doorVerdict(none, 'clean', true, true), 'invalid')
  const leaked = { witnessSeen: true, fakes: [{ hits: [{}] }] } as never
  assert.equal(doorVerdict(leaked, 'clean', false, true), 'leak')
})
