// Check 0.10: does the plugin hide content on every surface (terminal, VS Code
// panel, desktop Code tab)? With on-hide, every canary in a row's text blocks
// and tool results is replaced by [HIDDEN] before the row is stored, so the
// model never reads it. Run by hand on each surface (findings-step0.md).

import type { EngineInterface, SessionAppendInput } from 'claude-code'
import { CANARY_RE, checkLine, isOn, label } from './common.ts'
import { append } from '../log.ts'

type Block = { type?: unknown; text?: unknown; content?: unknown; [k: string]: unknown }

function scrub(text: string): { text: string; n: number } {
  let n = 0
  const out = text.replace(CANARY_RE, () => {
    n += 1
    return '[HIDDEN]'
  })
  return { text: out, n }
}

function scrubBlocks(blocks: readonly Block[]): { blocks: Block[]; n: number } {
  let n = 0
  const out = blocks.map(b => {
    if (b?.type === 'text' && typeof b.text === 'string') {
      const s = scrub(b.text)
      n += s.n
      return s.n > 0 ? { ...b, text: s.text } : b
    }
    if (b?.type === 'tool_result' && typeof b.content === 'string') {
      const s = scrub(b.content)
      n += s.n
      return s.n > 0 ? { ...b, content: s.text } : b
    }
    if (b?.type === 'tool_result' && Array.isArray(b.content)) {
      const inner = scrubBlocks(b.content as Block[])
      n += inner.n
      return inner.n > 0 ? { ...b, content: inner.blocks } : b
    }
    return b
  })
  return { blocks: out, n }
}

/** The row to store: with on-hide, its canaries replaced by [HIDDEN]. */
export async function hideRewrite($: EngineInterface, e: SessionAppendInput): Promise<{ row: SessionAppendInput; hidden: number }> {
  const content = e.message.content
  if (!Array.isArray(content) || !(await isOn($, 'hide'))) return { row: e, hidden: 0 }
  const { blocks, n } = scrubBlocks(content as readonly Block[])
  return n > 0 ? { row: { ...e, message: { ...e.message, content: blocks } } as SessionAppendInput, hidden: n } : { row: e, hidden: 0 }
}

export async function hideLog($: EngineInterface, e: SessionAppendInput, hidden: number): Promise<void> {
  await append($, await checkLine($, '0.10', { door: label(e.door), hidden }))
}
