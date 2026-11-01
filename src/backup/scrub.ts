// Cleans a tool's response for the backup lock (spec §5.2, check 0.9): every string in it goes through
// `redact`, and the value comes back in the same shape, because Claude Code ignores an answer that doesn't
// match the tool's own result. Objects are copied, never changed in place.

import type { Hit, Redacted } from '../core/session.ts'

export type ScrubOptions = {
  /** All strings together, in characters. Over this the response is not scanned (R-12). */
  maxChars?: number
  /** Deeper than this is left as it is and counts as an unfinished check. */
  maxDepth?: number
}

export type ScrubResult = {
  value: unknown
  hits: Hit[]
  /** False when a time limit, the size cap or the depth cap stopped some check. */
  complete: boolean
  oversize: boolean
  changed: boolean
}

export const MAX_CHARS = 4 * 1024 * 1024
const MAX_DEPTH = 128
/** Keys whose text says what a block is, not what it holds. A withheld response keeps them so it still fits the tool's shape. */
const STRUCTURAL = new Set(['type', 'kind', 'role', 'status', 'mimeType', 'media_type', 'encoding', 'format', 'name', 'subtype'])

/** Total string length, stopping as soon as it passes `limit`. Iterative, so a deep value can't overflow the stack. */
function sizeOf(value: unknown, limit: number): number {
  let total = 0
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const v = stack.pop()
    if (typeof v === 'string') {
      total += v.length
      if (total > limit) return total
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push(x)
    } else if (typeof v === 'object' && v !== null) {
      for (const x of Object.values(v)) stack.push(x)
    }
  }
  return total
}

export function scrubResponse(value: unknown, redact: (text: string) => Redacted, o: ScrubOptions = {}): ScrubResult {
  const maxChars = o.maxChars ?? MAX_CHARS
  const maxDepth = o.maxDepth ?? MAX_DEPTH
  if (sizeOf(value, maxChars) > maxChars) return { value, hits: [], complete: false, oversize: true, changed: false }
  const hits = new Map<string, Hit>()
  let complete = true
  let changed = false
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      if (v === '') return v
      const r = redact(v)
      if (!r.complete) complete = false
      for (const h of r.hits) if (!hits.has(h.tag)) hits.set(h.tag, h)
      if (r.text !== v) changed = true
      return r.text
    }
    if (typeof v !== 'object' || v === null) return v
    if (depth >= maxDepth) {
      complete = false
      return v
    }
    if (Array.isArray(v)) return v.map(x => walk(x, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = walk(x, depth + 1)
    return out
  }
  const cleaned = walk(value, 0)
  return { value: cleaned, hits: [...hits.values()], complete, oversize: false, changed }
}

/** The response with every text replaced by `note`, in the same shape. For a check that could not finish under `hold`. */
export function withholdResponse(value: unknown, note: string, depth = 0): unknown {
  if (typeof value === 'string') return note
  if (typeof value !== 'object' || value === null) return value
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? [] : {}
  if (Array.isArray(value)) return value.map(x => withholdResponse(x, note, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(value)) out[k] = typeof x === 'string' && STRUCTURAL.has(k) ? x : withholdResponse(x, note, depth + 1)
  return out
}
