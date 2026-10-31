// What each hook does, as functions of `$` and plain data. register.ts wires them to the events and
// owns `next`, `.catch` and the pinned fields. Nothing here writes a secret anywhere: log lines hold
// labels, tags and redacted text only, and the warnings hold no content.

import type { Args, EngineInterface, SessionAppendInput } from 'claude-code'
import { now } from './lib/core/decoder.ts'
import type { LogEntry } from './lib/core/log.ts'
import type { Hit } from './lib/core/session.ts'
import { redactRow, withheldRow, type RowMessage } from './lib/core/rows.ts'
import { PLACEHOLDER_NOTE } from './lib/core/note.ts'
import { pruneLogs, writeLog } from './log-file.ts'
import { markEnded, markRunning } from './marker.ts'
import { failureMode, fileOfTool, ready, rememberToolFile, saveCatches, type Runtime } from './runtime.ts'
import { warn } from './warn.ts'

/** The most CPU one hook spends on checking. The worker is stopped at about 6 s (check 0.6). */
const BUDGET_MS = 4000
const MAX_LOGGED_HITS = 50
const BLOCKED_REASON = 'it holds a secret that the settings say to block'

type Message = SessionAppendInput['message']
type Context = Args<'prompt.context'>
type Block = Context['blocks'][number]

const cleaner = (rt: Runtime) => (text: string): string => rt.redactor.redactText(text, { deadline: now() + 500 }).text

function entriesFor(rt: Runtime, t: number, door: string, where: string, hits: Hit[]): LogEntry[] {
  const out: LogEntry[] = hits.slice(0, MAX_LOGGED_HITS).map(h => ({
    t,
    event: h.action === 'warn' ? 'warn' : h.action === 'block' ? 'block' : 'hide',
    door,
    where,
    rule: h.ruleId,
    label: h.label,
    tag: h.tag,
    action: h.action,
    mode: rt.settings.mode,
  }))
  if (hits.length > MAX_LOGGED_HITS) out.push({ t, event: 'notice', door, where, detail: `${hits.length - MAX_LOGGED_HITS} more hits in this text` })
  return out
}

async function report($: EngineInterface, rt: Runtime, door: string, where: string, hits: Hit[]): Promise<void> {
  if (hits.length === 0) return
  await writeLog($, entriesFor(rt, await $.clock.now(), door, where, hits), cleaner(rt))
}

async function failed($: EngineInterface, rt: Runtime, door: string, where: string, kind: string, held: boolean): Promise<void> {
  warn($, `failure-${kind}`, `a check did not finish (${kind}) on ${where}. ${held ? 'That content was withheld.' : 'What was found is hidden, but the rest went through unchecked.'}`)
  await writeLog($, [{ t: await $.clock.now(), event: 'failure', door, where, action: held ? 'held' : 'allowed', mode: rt.settings.mode, detail: kind }], cleaner(rt))
}

function capWarning($: EngineInterface): void {
  warn($, 'catch-cap', 'the list of values caught this session is full; new ones are still hidden by their shape, but not remembered')
}

const whereOf = (e: SessionAppendInput): string => (e.origin.kind === 'tool' ? e.origin.tool : e.door)

/** The tool, and the file a Read named. Redacted by the log before it is written (R-17). */
function whereWithFile(e: SessionAppendInput, message: RowMessage): string {
  const result = message.content.find(b => b.type === 'tool_result' && typeof b.tool_use_id === 'string')
  const file = result ? fileOfTool(result.tool_use_id as string) : undefined
  return file === undefined ? whereOf(e) : `${whereOf(e)} ${file}`
}

/**
 * One log line for a failed hook (R-12). Static words only, so it needs no redactor: a `.catch` has one
 * second, and the worker may have just restarted. A clock that fails must not lose the line.
 */
async function logFailure($: EngineInterface, door: string, where: string, kind: string, held: boolean): Promise<void> {
  const t = await $.clock.now().catch(() => Date.now())
  await writeLog($, [{ t, event: 'failure', door, where, action: held ? 'held' : 'allowed', detail: kind }], text => text)
}

// ---- session.append ---------------------------------------------------------------------

export async function cleanAppend($: EngineInterface, e: SessionAppendInput): Promise<Message> {
  const rt = await ready($)
  const message = e.message as unknown as RowMessage
  if (e.door === 'response') {
    for (const b of message.content) if (b.type === 'tool_use' && typeof b.id === 'string') rememberToolFile(b.id, b.name, b.input)
  }
  const res = redactRow(rt.redactor, message, { deadline: now() + BUDGET_MS, fileOf: fileOfTool })
  await saveCatches($, rt)
  const where = whereWithFile(e, message)
  await report($, rt, e.door, where, res.hits)
  if (res.capped) capWarning($)
  if (res.blocked) return withheldRow(message, BLOCKED_REASON) as unknown as Message
  if (!res.complete) {
    const held = rt.settings.on_check_failure === 'hold'
    await failed($, rt, e.door, where, 'timeout', held)
    if (held) return withheldRow(message, 'a check could not finish') as unknown as Message
  }
  return res.message as unknown as Message
}

/** A failed append hook (R-03, R-12). Reads settings with free `$` calls only: the handler has one second. */
export async function failedAppend($: EngineInterface, e: SessionAppendInput, kind: string): Promise<Message> {
  const held = (await failureMode($)) === 'hold'
  warn($, `failure-${kind}`, `a check failed (${kind}) on ${whereOf(e)}. ${held ? 'That content was withheld.' : 'That content reached the model unchecked.'}`)
  await logFailure($, e.door, whereOf(e), kind, held)
  return held ? (withheldRow(e.message as unknown as RowMessage, 'a check failed') as unknown as Message) : e.message
}

// ---- prompt.submit ----------------------------------------------------------------------

export type SubmitAnswer = { text: string; context?: string[] } | { drop: string }

export async function cleanSubmit($: EngineInterface, e: Args<'prompt.submit'>): Promise<SubmitAnswer> {
  const rt = await ready($)
  const deadline = now() + BUDGET_MS
  const res = rt.redactor.redactText(e.text, { deadline })
  const hits = [...res.hits]
  let complete = res.complete
  let blocked = res.blocked
  let capped = res.capped
  let context: string[] | undefined
  if (e.context) {
    context = e.context.map(c => {
      const r = rt.redactor.redactText(c, { deadline })
      hits.push(...r.hits)
      if (!r.complete) complete = false
      if (r.blocked) blocked = true
      if (r.capped) capped = true
      return r.text
    })
  }
  await saveCatches($, rt)
  await report($, rt, 'prompt', 'prompt', hits)
  if (capped) capWarning($)
  if (blocked) return { drop: 'secret-shield: your message holds a secret that your settings say to block, so it was not sent.' }
  if (!complete) {
    const held = rt.settings.on_check_failure === 'hold'
    await failed($, rt, 'prompt', 'your message', 'timeout', held)
    if (held) return { drop: 'secret-shield could not finish checking your message, so it was not sent. Try again, or send less at once.' }
  }
  return context ? { text: res.text, context } : { text: res.text }
}

export async function failedSubmit($: EngineInterface, kind: string): Promise<SubmitAnswer | undefined> {
  const held = (await failureMode($)) === 'hold'
  warn($, `failure-${kind}`, `a check failed (${kind}) on your message. ${held ? 'It was not sent.' : 'It went through unchecked.'}`)
  await logFailure($, 'prompt', 'prompt', kind, held)
  return held ? { drop: 'secret-shield could not check your message, so it was not sent.' } : undefined
}

// ---- prompt.context, prompt.attachment --------------------------------------------------

const ENGINE_BLOCKS = new Set(['userEmail', 'attachedProject', 'currentDate', 'gitStatus', 'perforceMode', 'workerToolsContext'])

export async function cleanContext($: EngineInterface, e: Context): Promise<Block[]> {
  const rt = await ready($)
  const deadline = now() + BUDGET_MS
  const hits: Hit[] = []
  let failedCheck = false
  let capped = false
  const held = rt.settings.on_check_failure === 'hold'
  const blocks = e.blocks.map(b => {
    const r = rt.redactor.redactText(b.text, { deadline })
    hits.push(...r.hits)
    if (r.capped) capped = true
    if (r.blocked) return { name: b.name, text: '' }
    if (!r.complete) {
      failedCheck = true
      if (held) return { name: b.name, text: '' }
    }
    return { name: b.name, text: r.text }
  })
  await saveCatches($, rt)
  await report($, rt, 'context', 'context', hits)
  if (capped) capWarning($)
  if (failedCheck) await failed($, rt, 'context', 'the project context', 'timeout', held)
  return blocks
}

export async function failedContext($: EngineInterface, e: Context, kind: string): Promise<Block[]> {
  const held = (await failureMode($)) === 'hold'
  warn($, `failure-${kind}`, `a check failed (${kind}) on the project context. ${held ? 'Instruction files were withheld.' : 'They reached the model unchecked.'}`)
  await logFailure($, 'context', 'context', kind, held)
  return held ? e.blocks.map(b => (b.name === 'claudeMd' || !ENGINE_BLOCKS.has(b.name) ? { name: b.name, text: '' } : { name: b.name, text: b.text })) : [...e.blocks]
}

const attachmentMemory = new Map<string, { version: number; text: string }>()
const MAX_REMEMBERED = 100
const MAX_REMEMBERED_CHARS = 2_000_000

export async function cleanAttachment($: EngineInterface, e: Args<'prompt.attachment'>): Promise<string> {
  const rt = await ready($)
  // The same attachment is rendered for every request, so a clean result is kept until something new is caught.
  const kept = attachmentMemory.get(e.text)
  if (kept && kept.version === rt.redactor.version) return kept.text
  const res = rt.redactor.redactText(e.text, { deadline: now() + BUDGET_MS })
  await saveCatches($, rt)
  await report($, rt, 'attachment', e.type, res.hits)
  if (res.capped) capWarning($)
  let text = res.text
  if (res.blocked) text = '[secret-shield withheld this content: ' + BLOCKED_REASON + ']'
  else if (!res.complete) {
    const held = rt.settings.on_check_failure === 'hold'
    await failed($, rt, 'attachment', e.type, 'timeout', held)
    if (held) text = '[secret-shield withheld this content: a check could not finish]'
  } else if (e.text.length <= MAX_REMEMBERED_CHARS) {
    if (attachmentMemory.size >= MAX_REMEMBERED) attachmentMemory.delete(attachmentMemory.keys().next().value as string)
    attachmentMemory.set(e.text, { version: rt.redactor.version, text })
  }
  return text
}

export async function failedAttachment($: EngineInterface, e: Args<'prompt.attachment'>, kind: string): Promise<string> {
  const held = (await failureMode($)) === 'hold'
  warn($, `failure-${kind}`, `a check failed (${kind}) on an attachment. ${held ? 'It was withheld.' : 'It reached the model unchecked.'}`)
  await logFailure($, 'attachment', e.type, kind, held)
  return held ? '[secret-shield withheld this content: a check failed]' : e.text
}

// ---- prompt.compose ---------------------------------------------------------------------

export { PLACEHOLDER_NOTE }

export async function failedCompose($: EngineInterface, kind: string): Promise<void> {
  warn($, 'compose', 'could not add its note about hidden values to the instructions')
  await logFailure($, 'compose', 'compose', kind, false)
}

// ---- session start and end --------------------------------------------------------------

export async function startUp($: EngineInterface): Promise<void> {
  const rt = await ready($)
  await markRunning($)
  await pruneLogs($, rt.settings.log.days)
  await writeLog($, [{ t: await $.clock.now(), event: 'start', mode: rt.settings.mode, detail: 'secret-shield started' }], cleaner(rt))
}

export async function shutDown($: EngineInterface): Promise<void> {
  await markEnded($)
}

/** After /clear the process goes on under a new id, and no session.start fires for it. */
export async function stillRunning($: EngineInterface): Promise<void> {
  await markRunning($)
}

export async function failedLifecycle($: EngineInterface, door: string, kind: string): Promise<void> {
  warn($, `failure-${door}`, `could not finish its ${door} step (${kind}); hiding carries on`)
  await logFailure($, door, door, kind, false)
}
