// The uninstall commands as text (plan step 6): what the docs show must be what the code builds, and none of it
// may name a value. The real runs are in tests/uninstall-real.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SERVICE, uninstallCommand, uninstallText } from '../src/core/uninstall.ts'

test('macOS deletes every item of the service, one after the other, and Linux clears by the service attribute', () => {
  assert.equal(SERVICE, 'aegiscontext')
  const mac = uninstallCommand('macos', { service: 'svc', dataDir: '/x' })
  assert.deepEqual(mac.slice(0, 2), ['sh', '-c'])
  assert.match(mac[2] ?? '', /while security delete-generic-password -s svc/)
  assert.deepEqual(uninstallCommand('linux', { service: 'svc', dataDir: '/x' }), ['secret-tool', 'clear', 'service', 'svc'])
})

test('Windows removes the data folder, which holds the encrypted files', () => {
  const argv = uninstallCommand('windows', { service: 'svc', dataDir: 'C:\Users\me\.claude\aegiscontext' })
  assert.equal(argv[0], 'powershell')
  assert.ok(argv.join(' ').includes('Remove-Item'))
  assert.ok(argv.join(' ').includes('C:\Users\me\.claude\aegiscontext'))
})

test('the text for the docs shows the default service and a placeholder folder', () => {
  const t = uninstallText()
  assert.ok(t.macos.includes('-s aegiscontext'))
  assert.equal(t.linux, 'secret-tool clear service aegiscontext')
  assert.equal(t.windows, 'Remove-Item -Recurse -Force "$env:USERPROFILE\\.claude\\aegiscontext"')
})
