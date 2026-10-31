// CLAUDE.md "Fake secrets in tests": fakes are built at test time from pieces.
// This guard searches every tracked file for a whole key in a known format, so a
// fake pasted into a test, a doc or a note fails here rather than in a push.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findWholeKeys } from '../tools/test-sets/whole-keys.ts'
import { makeFake, randomSource, type FakeKind } from '../tools/test-sets/fakes.ts'

const root = path.join(import.meta.dirname, '..')

test('the search finds a whole key of each scanned format', () => {
  const src = randomSource()
  const kinds: FakeKind[] = ['github-pat', 'gitlab-pat', 'aws-access-key', 'slack-bot', 'stripe', 'databricks', 'gcp', 'npm', 'private-key']
  for (const kind of kinds) {
    const f = makeFake(kind, src)
    assert.ok(findWholeKeys(`before ${f.value} after`).length > 0, kind)
  }
})

test('the search leaves prefixes and pieces alone', () => {
  assert.deepEqual(findWholeKeys("const a = 'ghp_' + rest; const b = ['AKIA', tail].join('')"), [])
})

test('no tracked file holds a whole key', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 })
    .split('\0')
    .filter(f => f !== '')
  assert.ok(tracked.length > 20)
  const bad: string[] = []
  for (const file of tracked) {
    const full = path.join(root, ...file.split('/'))
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue
    for (const label of findWholeKeys(fs.readFileSync(full, 'utf8'))) bad.push(`${file}: ${label}`)
  }
  assert.deepEqual(bad, [])
})
