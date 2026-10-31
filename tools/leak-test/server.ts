// The kit's mock of the model API. Claude Code is pointed at it with
// ANTHROPIC_BASE_URL. It plays a scripted reply per request and searches every
// request for the planted fakes as it arrives. Bodies are never kept and nothing
// is written to disk: only labels reach the records.
//
// Started from experiments/step0-mock/server.ts, which stays frozen for re-checks.
// Unlike it, this one records every request, whatever its path, reads compressed
// bodies, and flags what it can't read, because each of those could be a false pass.
//
// Node built-ins only. Listens on 127.0.0.1 only.

import http from 'node:http'
import zlib from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { scanRequest, type Needle, type ScanHit } from './detect.ts'

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
  /** Index among /v1/messages requests, from 0. */
  index: number
}

export type Script = (req: ParsedRequest) => Reply

export type Unreadable = 'too-large' | 'unknown-encoding' | 'bad-encoding'

export type RequestRecord = {
  i: number
  method: string
  path: string
  encoding: string
  /** Body size as received. */
  bytes: number
  hits: ScanHit[]
  /** Set when the body could not be searched. Such a run proves nothing. */
  unreadable?: Unreadable
  reply: Reply['kind'] | 'error' | 'count' | 'not-found'
}

export type MockOptions = {
  script?: Script
  needles?: readonly Needle[]
  maxBody?: number
}

export type LeakMock = {
  host: string
  port: number
  records: RequestRecord[]
  close: () => Promise<void>
}

const HOST = '127.0.0.1'
const MAX_BODY = 64 * 1024 * 1024
const SAFE = /^[A-Za-z0-9_.:/+-]{1,64}$/

export const safe = (v: unknown): string => (typeof v === 'string' && SAFE.test(v) ? v : '(odd)')

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

function apiError(res: http.ServerResponse, status: number, type: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ type: 'error', error: { type, message: type } }))
}

const DECODERS: Record<string, (b: Buffer) => Buffer> = {
  gzip: b => zlib.gunzipSync(b),
  'x-gzip': b => zlib.gunzipSync(b),
  deflate: b => zlib.inflateSync(b),
  br: b => zlib.brotliDecompressSync(b),
  zstd: b => zlib.zstdDecompressSync(b),
}

function decode(body: Buffer, encoding: string): { body: Buffer } | { unreadable: Unreadable } {
  if (encoding === '' || encoding === 'identity') return { body }
  // A body can be encoded more than once; the header lists the steps in the order applied.
  let out = body
  for (const step of encoding.split(',').map(s => s.trim().toLowerCase()).reverse()) {
    const decoder = DECODERS[step]
    if (!decoder) return { unreadable: 'unknown-encoding' }
    try {
      out = decoder(out)
    } catch {
      return { unreadable: 'bad-encoding' }
    }
  }
  return { body: out }
}

const defaultScript: Script = () => ({ kind: 'text', text: 'mock-ok' })

export function startLeakMock(opts: MockOptions = {}): Promise<LeakMock> {
  const script = opts.script ?? defaultScript
  const needles = opts.needles ?? []
  const maxBody = opts.maxBody ?? MAX_BODY
  const records: RequestRecord[] = []
  let messageIndex = 0

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > maxBody) {
        tooBig = true
        chunks.length = 0
      } else if (!tooBig) {
        chunks.push(c)
      }
    })
    req.on('end', () => {
      const url = req.url ?? '/'
      const path = url.split('?')[0] ?? '/'
      const header = req.headers['content-encoding']
      const encoding = typeof header === 'string' ? header : ''
      const record: RequestRecord = {
        i: records.length,
        method: safe(req.method),
        path: safe(path),
        encoding: safe(encoding === '' ? 'identity' : encoding),
        bytes: size,
        hits: [],
        reply: 'error',
      }
      records.push(record)
      const view = { method: req.method ?? '', url, headers: req.headers }

      if (tooBig) {
        record.unreadable = 'too-large'
        record.hits = scanRequest({ ...view, body: Buffer.alloc(0) }, needles)
        return apiError(res, 413, 'request_too_large')
      }
      const decoded = decode(Buffer.concat(chunks), encoding)
      if ('unreadable' in decoded) {
        record.unreadable = decoded.unreadable
        record.hits = scanRequest({ ...view, body: Buffer.alloc(0) }, needles)
        return apiError(res, 400, 'invalid_request_error')
      }
      record.hits = scanRequest({ ...view, body: decoded.body }, needles)

      if (req.method !== 'POST' || !path.startsWith('/v1/messages')) {
        record.reply = 'not-found'
        return apiError(res, 404, 'not_found_error')
      }
      const raw = decoded.body.toString('utf8')
      if (path.endsWith('/count_tokens')) {
        record.reply = 'count'
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ input_tokens: Math.ceil(raw.length / 4) }))
      }
      let json: Record<string, unknown>
      try {
        json = JSON.parse(raw) as Record<string, unknown>
        if (json === null || typeof json !== 'object') throw new Error('not an object')
      } catch {
        return apiError(res, 400, 'invalid_request_error')
      }
      const messages = (Array.isArray(json.messages) ? json.messages : []) as Message[]
      const model = typeof json.model === 'string' ? json.model : 'mock'
      const stream = json.stream === true
      const tools = (Array.isArray(json.tools) ? json.tools : []) as { name?: unknown }[]
      const users = messages.filter(m => m.role === 'user')
      const parsed: ParsedRequest = {
        path,
        model,
        stream,
        hasTools: tools.length > 0,
        toolNames: tools.map(x => (typeof x?.name === 'string' ? x.name : '')),
        messages,
        lastUserText: textOfContent(users.at(-1)?.content),
        firstUserText: textOfContent(users[0]?.content),
        index: messageIndex++,
      }
      let reply: Reply
      try {
        reply = script(parsed)
      } catch {
        return apiError(res, 500, 'api_error')
      }
      record.reply = reply.kind
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
