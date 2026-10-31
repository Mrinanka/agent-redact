// Turns a session.append row into metadata: door, kinds, ids and sizes.
// Never content. Everything recorded comes from an allow-list, and every string
// that is recorded must look like an identifier, or it is replaced by ODD.

import type { SessionAppendInput } from 'claude-code'

export const ODD = '(odd)'

type Block = { type: string; [field: string]: unknown }

export type BlockSummary = Record<string, string | number | boolean | BlockSummary[]>

export type RowLine = {
  kind: 'row'
  seq: number
  t: number
  door: string
  type: string
  name?: string
  role?: string
  isMeta?: true
  origin: Record<string, string>
  uuid: string
  agentId?: string
  blocks: BlockSummary[]
}

// Kinds, door names, attachment names: short lowercase words.
const WORD = /^[a-z][a-z0-9_-]{0,63}$/
// Ids and names: tool names (incl. mcp__server__tool), model ids, uuids, agent ids, plugin names.
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/
const MEDIA_TYPE = /^[a-z]+\/[a-z0-9.+-]{1,64}$/

const word = (v: unknown): string => (typeof v === 'string' && WORD.test(v) ? v : ODD)
const id = (v: unknown): string => (typeof v === 'string' && ID.test(v) ? v : ODD)
const len = (v: unknown): number => (typeof v === 'string' ? v.length : 0)

// The origin fields worth recording; any other field is left out.
const ORIGIN_FIELDS = ['tool', 'model', 'event', 'name'] as const

export function summarizeOrigin(origin: SessionAppendInput['origin']): Record<string, string> {
  const o = origin as Record<string, unknown>
  const out: Record<string, string> = { kind: word(o.kind) }
  for (const f of ORIGIN_FIELDS) if (f in o) out[f] = id(o[f])
  return out
}

function summarizeMedia(b: Block): BlockSummary {
  const src = (typeof b.source === 'object' && b.source !== null ? b.source : {}) as Record<string, unknown>
  const out: BlockSummary = { type: b.type, source: word(src.type) }
  if (typeof src.media_type === 'string') out.mediaType = MEDIA_TYPE.test(src.media_type) ? src.media_type : ODD
  out.chars = len(src.data) + len(src.url)
  return out
}

export function summarizeBlock(raw: unknown): BlockSummary {
  const b = (typeof raw === 'object' && raw !== null ? raw : { type: '' }) as Block
  const type = word(b.type)
  switch (type) {
    case 'text':
      return { type, chars: len(b.text) }
    case 'thinking':
      return { type, chars: len(b.thinking) }
    case 'redacted_thinking':
      return { type, chars: len(b.data) }
    case 'tool_use':
      return { type, name: id(b.name), inputChars: JSON.stringify(b.input ?? null).length }
    case 'tool_result': {
      const isError = b.is_error === true
      if (Array.isArray(b.content)) return { type, isError, parts: b.content.map(summarizeBlock) }
      return { type, isError, chars: len(b.content) }
    }
    case 'image':
    case 'document':
      return summarizeMedia({ ...b, type })
    default:
      return { type }
  }
}

export function summarizeRow(e: SessionAppendInput, seq: number, t: number): RowLine {
  const m = e.message
  const line: RowLine = {
    kind: 'row',
    seq,
    t,
    door: word(e.door),
    type: word(m.type),
    origin: summarizeOrigin(e.origin),
    uuid: id(e.uuid),
    blocks: Array.isArray(m.content) ? m.content.map(summarizeBlock) : [],
  }
  if (m.name !== undefined) line.name = word(m.name)
  if (m.role !== undefined) line.role = word(m.role)
  if (m.isMeta === true) line.isMeta = true
  if (e.agentId !== undefined) line.agentId = id(e.agentId)
  return line
}
