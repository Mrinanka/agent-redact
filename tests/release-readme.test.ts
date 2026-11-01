// The README's install line, turned into the commands a terminal can run (plan step 6 "Done when": a newcomer
// installs from the README alone, on three systems). The real run, from GitHub, is the release workflow's job.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { installCommands } from '../tools/release/readme-install.ts'

const readme = fs.readFileSync(path.join(import.meta.dirname, '..', 'README.md'), 'utf8')

test('the README install line becomes a marketplace add and an install, by the names the marketplace uses', () => {
  const cmds = installCommands(readme)
  assert.deepEqual(cmds, [
    ['plugin', 'marketplace', 'add', 'Mrinanka/aegiscontext'],
    ['plugin', 'install', 'aegiscontext@aegiscontext'],
  ])
})

test('the marketplace name used for the install is the one in .claude-plugin/marketplace.json', () => {
  const m = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8')) as { name: string }
  assert.equal(installCommands(readme)[1]?.[2], `aegiscontext@${m.name}`)
})

test('a README with no install line, or two different ones, is an error rather than a guess', () => {
  assert.throws(() => installCommands('# nothing here'), /no install line/)
  assert.throws(() => installCommands('```\n/plugin install a --marketplace o/r\n/plugin install b --marketplace o/r\n```'), /more than one/)
})

test('only a line inside a code block counts, and a name with shell characters is refused', () => {
  assert.throws(() => installCommands('Run /plugin install aegiscontext --marketplace Mrinanka/aegiscontext in prose'), /no install line/)
  assert.throws(() => installCommands('```\n/plugin install a;rm --marketplace o/r\n```'), /unexpected/)
})
