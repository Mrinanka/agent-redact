// The install snippets (plan step 5 item 5, D-069): the settings the backup lock needs, built in one place so
// `/redact backup` prints the same thing the docs show.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { backupSnippet, SNIPPET_MAIN, SNIPPET_POLICY } from '../src/core/snippet.ts'

type Hook = { type: string; command: string; args: string[]; timeout: number; onFailure?: string }
const hooksOf = (s: ReturnType<typeof backupSnippet>, event: string): Hook[] => (s.hooks[event as keyof typeof s.hooks] as { hooks: Hook[] }[]).flatMap(g => g.hooks)

test('three events, each a command hook in exec form with no shell', () => {
  const s = backupSnippet({ main: '/home/me/.claude/aegiscontext/backup/backup/main.js', managed: false })
  assert.deepEqual(Object.keys(s.hooks).sort(), ['PostToolUse', 'PreToolUse', 'UserPromptSubmit'])
  for (const event of Object.keys(s.hooks)) {
    const [h] = hooksOf(s, event)
    assert.equal(h?.type, 'command')
    assert.equal(h?.command, 'node')
    assert.deepEqual(h?.args, ['/home/me/.claude/aegiscontext/backup/backup/main.js'])
    assert.equal(h?.timeout, 30)
  }
})

test('Personal mode does not set onFailure; Managed mode blocks on failure', () => {
  const personal = backupSnippet({ main: '/x/main.js', managed: false })
  const managed = backupSnippet({ main: '/x/main.js', managed: true })
  for (const event of Object.keys(personal.hooks)) {
    assert.equal(hooksOf(personal, event)[0]?.onFailure, undefined, event)
    assert.equal(hooksOf(managed, event)[0]?.onFailure, 'block', event)
  }
})

test('a policy file is passed as --policy, after the program', () => {
  const s = backupSnippet({ main: '/x/main.js', managed: true, policyFile: '/etc/policy.json' })
  assert.deepEqual(hooksOf(s, 'PreToolUse')[0]?.args, ['/x/main.js', '--policy', '/etc/policy.json'])
})

test('a Windows path with spaces and an apostrophe survives JSON', () => {
  const main = "C:\\Users\\O'Neil Jr\\.claude\\aegiscontext\\backup\\backup\\main.js"
  const text = JSON.stringify(backupSnippet({ main, managed: false }))
  assert.deepEqual(((JSON.parse(text) as ReturnType<typeof backupSnippet>).hooks.PreToolUse as { hooks: Hook[] }[])[0]?.hooks[0]?.args, [main])
})

test('the files in docs/snippets are exactly what the builder makes', () => {
  const dir = path.join(import.meta.dirname, '..', 'docs', 'snippets')
  const want: [string, ReturnType<typeof backupSnippet>][] = [
    ['personal.json', backupSnippet({ main: SNIPPET_MAIN, managed: false })],
    ['managed.json', backupSnippet({ main: SNIPPET_MAIN, managed: true, policyFile: SNIPPET_POLICY })],
  ]
  for (const [name, snippet] of want) assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), `${JSON.stringify(snippet, null, 2)}\n`, name)
})

test('the organization install settings: folder marketplace, plugin enabled, and the guard listed after the plugin', async () => {
  const { orgPluginSnippet, SNIPPET_MARKETPLACE } = await import('../src/core/snippet.ts')
  const s = orgPluginSnippet(SNIPPET_MARKETPLACE)
  assert.deepEqual(s.prependPlugins, ['aegiscontext@aegiscontext', 'sec-default@builtin'])
  assert.equal(s.enabledPlugins['aegiscontext@aegiscontext'], true)
  assert.deepEqual(s.extraKnownMarketplaces.aegiscontext.source, { source: 'directory', path: SNIPPET_MARKETPLACE })
  const file = path.join(import.meta.dirname, '..', 'docs', 'snippets', 'managed-plugin.json')
  assert.equal(fs.readFileSync(file, 'utf8'), `${JSON.stringify(s, null, 2)}\n`, 'docs/snippets/managed-plugin.json')
})
