// The kit's network trap: a local proxy that refuses and logs every outbound
// attempt. Claude Code is pointed at it with HTTPS_PROXY and HTTP_PROXY, with
// 127.0.0.1 exempt so the mock still works. Any attempt makes a run invalid.
//
// It only sees traffic that honours the proxy settings (docs:
// code.claude.com/docs/en/network-config), so CI adds a Linux run with no network.
// Hosts only: paths, queries and bodies are never read.

import http from 'node:http'
import type { Duplex } from 'node:stream'

export type Attempt = { kind: 'connect' | 'http'; host: string }

export type Trap = {
  host: string
  port: number
  attempts: Attempt[]
  close: () => Promise<void>
}

const HOST = '127.0.0.1'
const SAFE_HOST = /^[A-Za-z0-9.:_-]{1,128}$/

const label = (v: unknown): string => (typeof v === 'string' && SAFE_HOST.test(v) ? v : '(odd)')

export function startTrap(): Promise<Trap> {
  const attempts: Attempt[] = []
  const sockets = new Set<Duplex>()

  const server = http.createServer((req, res) => {
    attempts.push({ kind: 'http', host: label(req.headers.host) })
    res.writeHead(403, { connection: 'close' })
    res.end()
  })
  server.on('connect', (req, socket) => {
    attempts.push({ kind: 'connect', host: label(req.url) })
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    // A client may drop the connection first; that must not bring the trap down.
    socket.on('error', () => {})
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
  })
  server.on('clientError', (_err, socket) => socket.destroy())

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, HOST, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        host: HOST,
        port,
        attempts,
        close: () => new Promise<void>(done => {
          for (const s of sockets) s.destroy()
          server.closeAllConnections()
          server.close(() => done())
        }),
      })
    })
  })
}
