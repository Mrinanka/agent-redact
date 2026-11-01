// The uninstall commands as text (plan step 6): what the docs show must be what the code builds, and none of it
// may name a value. The real runs are in tests/uninstall-real.test.ts. On macOS and Linux the data folder goes too,
// because the real macOS run in CI showed a marker file (`store/has-list`) staying behind after the store was emptied.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SERVICE, uninstallCommand, uninstallText } from '../src/core/uninstall.ts'

test('macOS deletes every item of the service, one after the other, then the data folder', () => {
  assert.equal(SERVICE, 'aegiscontext')
  const mac = uninstallCommand('macos', { service: 'svc', dataDir: '/x' })
  assert.deepEqual(mac.slice(0, 2), ['sh', '-c'])
  assert.match(mac[2] ?? '', /while security delete-generic-password -s svc/)
  assert.match(mac[2] ?? '', /; rm -rf '\/x'$/)
})

test('Linux clears by the service attribute, then removes the data folder', () => {
  assert.deepEqual(uninstallCommand('linux', { service: 'svc', dataDir: '/x' }), ['sh', '-c', "secret-tool clear service svc; rm -rf '/x'"])
})

test('a folder name with an apostrophe or a space stays one word for the shell', () => {
  const argv = uninstallCommand('linux', { service: 'svc', dataDir: "/home/o'neil/my claude" })
  assert.equal(argv[2], "secret-tool clear service svc; rm -rf '/home/o'\\''neil/my claude'")
})

test('Windows removes the data folder, which holds the encrypted files', () => {
  const argv = uninstallCommand('windows', { service: 'svc', dataDir: 'C:\\Users\\me\\.claude\\aegiscontext' })
  assert.equal(argv[0], 'powershell')
  assert.ok(argv.join(' ').includes('Remove-Item'))
  assert.ok(argv.join(' ').includes('C:\\Users\\me\\.claude\\aegiscontext'))
})

test('the text for the docs shows the default service and the default folder', () => {
  const t = uninstallText()
  assert.equal(t.macos, 'while security delete-generic-password -s aegiscontext >/dev/null 2>&1; do :; done; rm -rf "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/aegiscontext"')
  assert.equal(t.linux, 'secret-tool clear service aegiscontext; rm -rf "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/aegiscontext"')
  assert.equal(t.windows, 'Remove-Item -Recurse -Force "$env:USERPROFILE\\.claude\\aegiscontext"')
})
