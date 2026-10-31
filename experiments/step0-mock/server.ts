// Step 0 mock of the model API (D-020). Claude Code is pointed at it with
// ANTHROPIC_BASE_URL. It plays a scripted reply per request and records each
// request's SHAPE: roles, block types, sizes, and whether each canary was seen.
// It never records content: canaries are recorded by index (c0, c1, ...),
// names and media types only when they look like plain identifiers.
//
// Node built-ins only. Listens on 127.0.0.1 only.

import http from 'node:http'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'

export type Reply =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: Record<string, unknown>; text?: string }

type Block = { type?: unknown; [k: string]: unknown }
export type Message = { role: string; content: string | Block[] }

export type ParsedRequest = {
  path: string
  model: string
  stream: boolean
  hasTools: boolean
  /** The request's tool names, as sent ('' for a tool without a name). */
  toolNames: readonly string[]
  messages: Message[]
  /** All text of the last user message: its text blocks and tool results, joined. */
  lastUserText: string
  /** All text of the first user message. */
  firstUserText: string
  /** Request index, from 0. */
  index: number
}

export type Script = (req: ParsedRequest) => Reply

export type BlockRecord = {
  type: string
  chars?: number
  name?: string
  isError?: boolean
  mediaType?: string
  /** For a tool_result with a block list: each part's type. */
  parts?: string[]
}

export type RequestRecord = {
  i: number
  path: string
  model: string
  stream: boolean
  nTools: number
  /** Tool names as safe labels. */
  tools: string[]
  systemChars: number
  msgs: { role: string; blocks: BlockRecord[] }[]
  /** Canary index (c0, c1, ...) to whether it appears anywhere in the raw body. */
  canaries: Record<string, boolean>
  reply: Reply['kind'] | 'error'
}

export type MockOptions = {
  script?: Script
  canaries?: readonly string[]
  /** JSONL file to append one RequestRecord per request to. */
  recordPath?: string
}

export type MockServer = {
  host: string
  port: number
  records: RequestRecord[]
  close: () => Promise<void>
}

const HOST = '127.0.0.1'
const MAX_BODY = 32 * 1024 * 1024
const SAFE = /^[A-Za-z0-9_.:/+-]{1,64}$/

const safe = (v: unknown): string => (typeof v === 'string' && SAFE.test(v) ? v : '(odd)')

function sizeOf(v: unknown): number {
  if (typeof v === 'string') return v.length
  if (v === undefined) return 0
  return JSON.stringify(v).length
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b: Block) => {
      if (b?.type === 'text' && typeof b.text === 'string') return b.text
      if (b?.type === 'tool_result') return textOfContent(b.content)
      return ''
    })
    .filter(s => s !== '')
    .join('\n')
}

function recordBlock(b: Block): BlockRecord {
  const type = safe(b?.type)
  switch (b?.type) {
    case 'text':
      return { type, chars: sizeOf(b.text) }
    case 'tool_use':
      return { type, name: safe(b.name), chars: sizeOf(b.input) }
    case 'tool_result': {
      const r: BlockRecord = { type, chars: typeof b.content === 'string' ? b.content.length : textOfContent(b.content).length }
      if (b.is_error === true) r.isError = true
      if (Array.isArray(b.content)) r.parts = (b.content as Block[]).map(p => safe(p?.type))
      return r
    }
    case 'image':
    case 'document': {
      const src = (b.source ?? {}) as Record<string, unknown>
      return { type, chars: sizeOf(src.data), mediaType: safe(src.media_type) }
    }
    default:
      return { type, chars: sizeOf(b) }
  }
}

function recordMessages(messages: Message[]): RequestRecord['msgs'] {
  return messages.map(m => ({
    role: safe(m.role),
    blocks: typeof m.content === 'string' ? [{ type: 'text', chars: m.content.length }] : (m.content ?? []).map(recordBlock),
  }))
}

function sse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function contentOf(reply: Reply, id: string): Block[] {
  if (reply.kind === 'text') return [{ type: 'text', text: reply.text }]
  const blocks: Block[] = []
  if (reply.text) blocks.push({ type: 'text', text: reply.text })
  blocks.push({ type: 'tool_use', id, name: reply.name, input: reply.input })
  return blocks
}

function answer(res: http.ServerResponse, model: string, stream: boolean, reply: Reply): void {
  const msgId = `msg_mock_${randomBytes(6).toString('hex')}`
  const toolId = `toolu_mock_${randomBytes(6).toString('hex')}`
  const stop = reply.kind === 'tool' ? 'tool_use' : 'end_turn'
  const content = contentOf(reply, toolId)
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: msgId, type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null, usage }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  sse(res, 'message_start', {
    type: 'message_start',
    message: { id: msgId, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } },
  })
  content.forEach((block, index) => {
    if (block.type === 'text') {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } })
    } else {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } })
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
    }
    sse(res, 'content_block_stop', { type: 'content_block_stop', index })
  })
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } })
  sse(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

const defaultScript: Script = () => ({ kind: 'text', text: 'mock-ok' })

export function startMock(opts: MockOptions = {}): Promise<MockServer> {
  const script = opts.script ?? defaultScript
  const canaries = opts.canaries ?? []
  const records: RequestRecord[] = []
  let index = 0

  const keep = (r: RequestRecord): void => {
    records.push(r)
    if (opts.recordPath) fs.appendFileSync(opts.recordPath, JSON.stringify(r) + '\n')
  }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) tooBig = true
      else chunks.push(c)
    })
    req.on('end', () => {
      const url = req.url ?? '/'
      const path = url.split('?')[0] ?? '/'
      if (tooBig) {
        res.writeHead(413, { 'content-type': 'application/json' })
        return res.end('{"type":"error","error":{"type":"request_too_large","message":"too large"}}')
      }
      if (req.method !== 'POST' || !path.startsWith('/v1/messages')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end('{"type":"error","error":{"type":"not_found_error","message":"not found"}}')
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      let json: Record<string, unknown>
      try {
        json = JSON.parse(raw) as Record<string, unknown>
        if (json === null || typeof json !== 'object') throw new Error('not an object')
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end('{"type":"error","error":{"type":"invalid_request_error","message":"bad json"}}')
      }
      if (path.endsWith('/count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ input_tokens: Math.ceil(raw.length / 4) }))
      }
      const messages = (Array.isArray(json.messages) ? json.messages : []) as Message[]
      const model = typeof json.model === 'string' ? json.model : 'mock'
      const stream = json.stream === true
      const tools = (Array.isArray(json.tools) ? json.tools : []) as { name?: unknown }[]
      const toolNames = tools.map(x => (typeof x?.name === 'string' ? x.name : ''))
      const users = messages.filter(m => m.role === 'user')
      const parsed: ParsedRequest = {
        path,
        model,
        stream,
        hasTools: tools.length > 0,
        toolNames,
        messages,
        lastUserText: textOfContent(users.at(-1)?.content),
        firstUserText: textOfContent(users[0]?.content),
        index: index++,
      }
      const record: RequestRecord = {
        i: parsed.index,
        path: safe(path),
        model: safe(model),
        stream,
        nTools: tools.length,
        tools: toolNames.map(safe),
        systemChars: sizeOf(json.system),
        msgs: recordMessages(messages),
        canaries: Object.fromEntries(canaries.map((c, i) => [`c${i}`, raw.includes(c)])),
        reply: 'error',
      }
      let reply: Reply
      try {
        reply = script(parsed)
      } catch {
        keep(record)
        res.writeHead(500, { 'content-type': 'application/json' })
        return res.end('{"type":"error","error":{"type":"api_error","message":"mock script failed"}}')
      }
      record.reply = reply.kind
      keep(record)
      answer(res, model, stream, reply)
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, HOST, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        host: HOST,
        port,
        records,
        close: () => new Promise<void>(done => {
          server.closeAllConnections()
          server.close(() => done())
        }),
      })
    })
  })
}
