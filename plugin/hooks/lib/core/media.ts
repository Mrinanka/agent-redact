// Images and documents (spec §6): v1 can't read them, so they pass with a notice or are dropped with a
// note to Claude. They also arrive nested inside a tool_result (check 0.5).

import type { RowBlock, RowMessage } from './rows.ts'

export const MEDIA_NOTE = '[secret-shield removed an image or document here, because the media setting is drop.]'

const isMedia = (b: RowBlock): boolean => b.type === 'image' || b.type === 'document'

export function hasMedia(message: RowMessage): boolean {
  return message.content.some(b => isMedia(b) || (b.type === 'tool_result' && Array.isArray(b.content) && (b.content as RowBlock[]).some(isMedia)))
}

export function dropMedia(message: RowMessage): { message: RowMessage; dropped: number } {
  if (!hasMedia(message)) return { message, dropped: 0 }
  let dropped = 0
  let top = 0
  const content: RowBlock[] = []
  for (const b of message.content) {
    if (isMedia(b)) {
      top++
    } else if (b.type === 'tool_result' && Array.isArray(b.content) && (b.content as RowBlock[]).some(isMedia)) {
      const parts = b.content as RowBlock[]
      const kept = parts.filter(p => !isMedia(p))
      dropped += parts.length - kept.length
      content.push({ ...b, content: [...kept, { type: 'text', text: MEDIA_NOTE }] })
    } else {
      content.push(b)
    }
  }
  dropped += top
  if (top > 0) content.push({ type: 'text', text: MEDIA_NOTE })
  return { message: { ...message, content }, dropped }
}
