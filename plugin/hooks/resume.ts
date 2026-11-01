// Resumed sessions (spec §6.1, R-06): rows loaded by a resume never pass session.append, so the raw
// history would be sent again. It is scanned once per session id, and while it holds a secret the next
// prompt is dropped, /compact is skipped and any other request is held.

import type { EngineInterface } from 'claude-code'
import { now } from './lib/core/decoder.ts'
import { outboundText } from './lib/core/outbound.ts'
import { writeLog } from './log-file.ts'
import { failureMode, ready } from './runtime.ts'
import { resumeState, setResumeState } from './state.ts'
import { warn } from './warn.ts'

const BUDGET_MS = 4000

const message = (n: number): string => `This session's history contains ${n} secrets that the model would see again. Start a new session (or /redact allow to continue anyway).`

type Block = { type?: string }

/** The reason to stop, while a resumed history holds a secret. Nothing means carry on. */
export async function resumeBlock($: EngineInterface): Promise<string | undefined> {
  const session = await $.session.id()
  const state = await resumeState($)
  if (state?.session === session) return state.found > 0 && !state.lifted ? message(state.found) : undefined
  const rt = await ready($)
  const history = (await $.session.messages({ as: 'api' })) as unknown as { content: Block[] }[]
  if (history.length === 0) {
    await setResumeState($, { session, found: 0, lifted: false })
    return undefined
  }
  const deadline = now() + BUDGET_MS
  const tags = new Set<string>()
  let complete = true
  for (const m of history) {
    const text = outboundText(m.content.filter(b => b.type !== 'image' && b.type !== 'document'))
    const res = rt.redactor.redactText(text, { deadline })
    for (const h of res.hits) if (h.action !== 'warn') tags.add(h.tag)
    if (!res.complete) {
      complete = false
      break
    }
  }
  const observe = rt.settings.mode === 'observe'
  await writeLog($, [{ t: await $.clock.now(), event: 'notice', door: 'resume', where: 'history', detail: `${observe ? 'would have blocked: ' : ''}resume scan found ${tags.size} secrets`, mode: rt.settings.mode }], t => t)
  if (!complete) {
    const held = rt.settings.on_check_failure === 'hold' && !observe
    warn($, 'failure-resume', `the check of this session's history did not finish. ${held ? 'Your message was not sent.' : 'It may reach the model unchecked.'}`)
    await writeLog($, [{ t: await $.clock.now(), event: 'failure', door: 'resume', where: 'history', action: held ? 'held' : 'allowed', detail: 'timeout' }], t => t)
    if (held) return 'aegiscontext could not finish checking this session\'s history, so your message was not sent. Start a new session, or send /redact allow to continue anyway.'
    await setResumeState($, { session, found: 0, lifted: false })
    return undefined
  }
  await setResumeState($, { session, found: observe ? 0 : tags.size, lifted: false })
  return tags.size > 0 && !observe ? message(tags.size) : undefined
}

/** The same, for a hook: a failed read follows on_check_failure and never stops the other checks. */
export async function safeResumeBlock($: EngineInterface): Promise<string | undefined> {
  try {
    return await resumeBlock($)
  } catch {
    const held = (await failureMode($)) === 'hold'
    warn($, 'failure-resume', `a check failed on this session's history. ${held ? 'Your message was not sent.' : 'It may reach the model unchecked.'}`)
    await writeLog($, [{ t: Date.now(), event: 'failure', door: 'resume', where: 'history', action: held ? 'held' : 'allowed', detail: 'read' }], t => t)
    return held ? 'aegiscontext could not check this session\'s history, so your message was not sent.' : undefined
  }
}

/** `/redact allow` with no tag. True when a block was lifted. */
export async function liftResume($: EngineInterface): Promise<boolean> {
  const session = await $.session.id()
  const state = await resumeState($)
  if (state?.session === session && state.found > 0 && !state.lifted) {
    await setResumeState($, { ...state, lifted: true })
    await writeLog($, [{ t: await $.clock.now(), event: 'notice', door: 'resume', where: 'history', detail: 'the person chose to continue with secrets in the history' }], t => t)
    return true
  }
  return false
}
