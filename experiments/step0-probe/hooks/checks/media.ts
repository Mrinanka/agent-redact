// Check 0.5: can image and document blocks be dropped at session.append?
// With on-media, every image or document block (top level, or inside a
// tool_result's content) is replaced by a short text note.

import type { EngineInterface, SessionAppendInput } from 'claude-code'
import { checkLine, isOn, label } from './common.ts'
import { append } from '../log.ts'

const NOTE = '[step0-probe: media dropped]'

type Block = { type?: unknown; content?: unknown; [k: string]: unknown }

const isMedia = (b: Block): boolean => b?.type === 'image' || b?.type === 'document'

function strip(blocks: readonly Block[]): { blocks: Block[]; dropped: number } {
  let dropped = 0
  const out = blocks.map(b => {
    if (isMedia(b)) {
      dropped += 1
      return { type: 'text', text: NOTE }
    }
    if (b?.type === 'tool_result' && Array.isArray(b.content)) {
      const inner = strip(b.content as Block[])
      dropped += inner.dropped
      return inner.dropped > 0 ? { ...b, content: inner.blocks } : b
    }
    return b
  })
  return { blocks: out, dropped }
}

/** The row to store: with on-media, its image and document blocks dropped. */
export async function mediaRewrite($: EngineInterface, e: SessionAppendInput): Promise<{ row: SessionAppendInput; dropped: number }> {
  const content = e.message.content
  if (!Array.isArray(content) || !(await isOn($, 'media'))) return { row: e, dropped: 0 }
  const { blocks, dropped } = strip(content as readonly Block[])
  if (dropped === 0) return { row: e, dropped: 0 }
  return { row: { ...e, message: { ...e.message, content: blocks } } as SessionAppendInput, dropped }
}

export async function mediaLog($: EngineInterface, e: SessionAppendInput, dropped: number): Promise<void> {
  await append($, await checkLine($, '0.5', { door: label(e.door), dropped }))
}
