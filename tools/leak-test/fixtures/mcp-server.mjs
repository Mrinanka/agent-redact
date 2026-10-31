// A connected tool for the leak test: a stdio MCP server with one tool whose
// result is the file named by LEAK_MCP_FILE. Newline-delimited JSON-RPC, Node
// built-ins only.

import fs from 'node:fs'
import readline from 'node:readline'

const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')

readline.createInterface({ input: process.stdin }).on('line', line => {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return
  }
  if (m.id === undefined) return
  switch (m.method) {
    case 'initialize':
      return send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'leak', version: '0.0.1' } } })
    case 'tools/list':
      return send({ id: m.id, result: { tools: [{ name: 'get_note', description: 'Returns a note.', inputSchema: { type: 'object', properties: {} } }] } })
    case 'tools/call':
      return send({ id: m.id, result: { content: [{ type: 'text', text: fs.readFileSync(process.env.LEAK_MCP_FILE, 'utf8') }] } })
    default:
      return send({ id: m.id, error: { code: -32601, message: 'method not found' } })
  }
})
