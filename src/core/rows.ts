// Applying a Redactor to a conversation row (plan step 3). A row's text blocks and its
// tool_result contents are cleaned; tool_use, thinking, media and unknown blocks are left alone,
// because the engine pins them (reference.md, "The rows a conversation keeps").

import type { Hit, Redacted, RedactTextOptions } from './session.ts'

export type RowBlock = { type: string; [field: string]: unknown }

/** A session.append message, as far as redaction cares. The other fields are pinned and kept. */
export type RowMessage = {
  type: string
  name?: string
  role?: string
  isMeta?: true
  content: RowBlock[]
}

/** What redactRow needs of a Redactor: tests stand in a spy. */
export type TextRedactor = {
  readonly version: number
  redactText(text: string, o: RedactTextOptions): Redacted
}

export type RowOptions = {
  deadline: number
  /** The file a tool_result came from, found by its tool_use_id. */
  fileOf?: (toolUseId: string) => string | undefined
}

export type RowResult = {
  message: RowMessage
  changed: boolean
  hits: Hit[]
  complete: boolean
  blocked: boolean
  capped: boolean
}

type Slot = { get: () => string; set: (text: string) => void; file: string | undefined }

/** Every piece of text in the row that may be cleaned, with a way to replace it. */
function slots(content: RowBlock[], fileOf: RowOptions['fileOf']): { blocks: RowBlock[]; list: Slot[] } {
  // Only the blocks that may change are copied; the rest keep their identity.
  const blocks = content.map(b => (b.type === 'text' || b.type === 'tool_result' ? { ...b } : b))
  const list: Slot[] = []
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') {
      list.push({ get: () => b.text as string, set: t => void (b.text = t), file: undefined })
    } else if (b.type === 'tool_result') {
      const file = typeof b.tool_use_id === 'string' ? fileOf?.(b.tool_use_id) : undefined
      if (typeof b.content === 'string') {
        list.push({ get: () => b.content as string, set: t => void (b.content = t), file })
      } else if (Array.isArray(b.content)) {
        const parts = (b.content as RowBlock[]).map(p => (p.type === 'text' ? { ...p } : p))
        b.content = parts
        for (const p of parts) {
          if (p.type === 'text' && typeof p.text === 'string') list.push({ get: () => p.text as string, set: t => void (p.text = t), file })
        }
      }
    }
  }
  return { blocks, list }
}

export function redactRow(r: TextRedactor, message: RowMessage, o: RowOptions): RowResult {
  const { blocks, list } = slots(message.content, o.fileOf)
  const hits: Hit[] = []
  let complete = true
  let blocked = false
  let capped = false
  let changed = false
  const startVersion = r.version
  const apply = (slot: Slot, recheck: boolean): void => {
    const before = slot.get()
    const res = r.redactText(before, { deadline: o.deadline, ...(slot.file !== undefined ? { file: slot.file } : {}), ...(recheck ? { recheck: true } : {}) })
    if (res.text !== before) {
      slot.set(res.text)
      changed = true
    }
    hits.push(...res.hits)
    if (!res.complete) complete = false
    if (res.blocked) blocked = true
    if (res.capped) capped = true
  }
  const versions: number[] = []
  for (const slot of list) {
    apply(slot, false)
    versions.push(r.version)
  }
  // A value caught in a later block must also be hidden in the blocks before it.
  if (r.version !== startVersion) {
    list.forEach((slot, i) => {
      if (versions[i] !== r.version) apply(slot, true)
    })
  }
  return { message: changed ? { ...message, content: blocks } : message, changed, hits, complete, blocked, capped }
}

const note = (reason: string): string => `[secret-shield withheld this content: ${reason}]`

/**
 * The row with its cleanable content replaced by a note that holds none of it (spec §12 `hold`,
 * and `block` on a row). Thinking and tool_use blocks stay, and so does every tool_result with
 * its id and error flag, because the engine puts them back anyway. Media is dropped.
 */
export function withheldRow(message: RowMessage, reason: string): RowMessage {
  const text = note(reason)
  const out: RowBlock[] = []
  let placed = false
  for (const b of message.content) {
    if (b.type === 'text') {
      if (!placed) out.push({ type: 'text', text })
      placed = true
    } else if (b.type === 'tool_result') {
      out.push({ ...b, content: text })
      placed = true
    } else if (b.type === 'image' || b.type === 'document') {
      // dropped
    } else {
      out.push(b)
    }
  }
  if (!placed && !out.some(b => b.type === 'text')) {
    // A row of media only: say what happened where the media was.
    if (message.content.some(b => b.type === 'image' || b.type === 'document')) out.push({ type: 'text', text })
  }
  return { ...message, content: out }
}
