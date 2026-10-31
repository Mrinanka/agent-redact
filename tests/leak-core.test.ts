// Guard: the `leak-test:core` script runs every door step 3 covers, and CI runs it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { SCENARIOS } from '../tools/leak-test/scenarios.ts'

const root = path.join(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }

test('leak-test:core names every scenario except mention-file and resume (steps 4 and later)', () => {
  const script = pkg.scripts['leak-test:core'] as string
  const named = [...script.matchAll(/--only ([a-z-]+)/g)].map(m => m[1] as string).sort()
  const expected = SCENARIOS.map(s => s.name).filter(n => n !== 'mention-file' && n !== 'resume').sort()
  assert.equal(expected.length, 11)
  assert.deepEqual(named, expected)
  assert.match(script, /--plugin plugin/)
})

test('CI runs the core leak test pinned, and the plugin build check', () => {
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  assert.match(ci, /leak-test:core -- --require-pinned/)
  assert.match(ci, /plugin:build -- --check/)
  assert.match(ci, /claude plugin validate \.\/plugin/)
})
