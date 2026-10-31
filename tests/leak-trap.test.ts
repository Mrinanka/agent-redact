// The kit's network trap (tools/leak-test/trap.ts): a local proxy that refuses and
// logs every outbound attempt. Claude Code is pointed at it with HTTPS_PROXY.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { startTrap, type Trap } from '../tools/leak-test/trap.ts'

function raw(t: Trap, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(t.port, t.host, () => s.write(text))
    let out = ''
    s.on('data', c => { out += c })
    s.on('close', () => resolve(out))
    s.on('error', reject)
  })
}

async function withTrap(fn: (t: Trap) => Promise<void>): Promise<void> {
  const t = await startTrap()
  try {
    await fn(t)
  } finally {
    await t.close()
  }
}

test('a CONNECT attempt is refused and logged by host', async () => {
  await withTrap(async t => {
    const answer = await raw(t, 'CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\n\r\n')
    assert.match(answer, /403/)
    assert.deepEqual(t.attempts, [{ kind: 'connect', host: 'api.anthropic.com:443' }])
  })
})

test('a plain proxied request is refused and logged by host', async () => {
  await withTrap(async t => {
    const answer = await raw(t, 'GET http://example.test/path?q=1 HTTP/1.1\r\nHost: example.test\r\n\r\n')
    assert.match(answer, /403/)
    assert.deepEqual(t.attempts, [{ kind: 'http', host: 'example.test' }])
  })
})

test('an odd host is logged as a safe label', async () => {
  await withTrap(async t => {
    await raw(t, 'CONNECT bad=host!value:443 HTTP/1.1\r\n\r\n')
    assert.deepEqual(t.attempts, [{ kind: 'connect', host: '(odd)' }])
  })
})

test('failure: a client that drops the connection does not crash the trap', async () => {
  await withTrap(async t => {
    await new Promise<void>(resolve => {
      const s = net.connect(t.port, t.host, () => {
        s.write('CONNECT a.test:443 HTTP/1.1\r\n\r\n')
        s.destroy()
        resolve()
      })
    })
    const answer = await raw(t, 'CONNECT b.test:443 HTTP/1.1\r\n\r\n')
    assert.match(answer, /403/)
  })
})

test('listens on 127.0.0.1 only', async () => {
  await withTrap(async t => {
    assert.equal(t.host, '127.0.0.1')
    assert.ok(t.port > 0)
  })
})
