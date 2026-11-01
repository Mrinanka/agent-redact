// The README's install line, turned into the commands a terminal can run (plan step 6 "Done when": a newcomer
// installs from the README alone, on three systems). The real run, from GitHub, is the release workflow's job.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { headProblem, installCommands } from '../tools/release/readme-install.ts'

const readme = fs.readFileSync(path.join(import.meta.dirname, '..', 'README.md'), 'utf8')

test('the README install line becomes the same line in the terminal form', () => {
  assert.deepEqual(installCommands(readme), {
    name: 'aegiscontext',
    source: 'Mrinanka/aegiscontext',
    args: ['plugin', 'install', 'aegiscontext', '--marketplace', 'Mrinanka/aegiscontext'],
  })
})

test('the plugin name used for the install is the one in .claude-plugin/marketplace.json', () => {
  const m = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8')) as { plugins: { name: string }[] }
  assert.equal(installCommands(readme).name, m.plugins[0]?.name)
})

test('the install proves the checked-out commit only when it is what GitHub hands a newcomer', () => {
  const sha = 'a'.repeat(40)
  const other = 'b'.repeat(40)
  assert.equal(headProblem(sha, `${sha}\tHEAD\n`), undefined)
  assert.match(headProblem(sha, `${other}\tHEAD\n`) ?? '', /default branch/)
  assert.match(headProblem(sha, '') ?? '', /could not read/)
  assert.match(headProblem(sha, 'not a line\n') ?? '', /could not read/)
})

test('a README with no install line, or two different ones, is an error rather than a guess', () => {
  assert.throws(() => installCommands('# nothing here'), /no install line/)
  assert.throws(() => installCommands('```\n/plugin install a --marketplace o/r\n/plugin install b --marketplace o/r\n```'), /more than one/)
})

test('only a line inside a code block counts, and a name with shell characters is refused', () => {
  assert.throws(() => installCommands('Run /plugin install aegiscontext --marketplace Mrinanka/aegiscontext in prose'), /no install line/)
  assert.throws(() => installCommands('```\n/plugin install a;rm --marketplace o/r\n```'), /unexpected/)
})
