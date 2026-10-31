// Check 0.3: on /resume or --resume, what can a plugin read of the loaded
// history before the first request, and can it hold that request?
// With on-resume: logs $.session.messages() as counts at session.start and at
// the first main turn.start. With on-resume-hold too: the first main
// turn.step answers without next, so no request is sent.

import type { EngineInterface, On, TurnStepResult } from 'claude-code'
import { checkLine, hasCanary, isOn } from './common.ts'
import { append } from '../log.ts'

let heldOnce = false
let turnLogged = false

async function snapshot($: EngineInterface, at: string): Promise<void> {
  const msgs = await $.session.messages()
  if (!Array.isArray(msgs)) return
  let user = 0
  let assistant = 0
  let canary = false
  for (const m of msgs) {
    if (m.role === 'user') user += 1
    else assistant += 1
    const text = 'text' in m && typeof m.text === 'string' ? m.text : JSON.stringify(m)
    if (hasCanary(text)) canary = true
  }
  await append($, await checkLine($, '0.3', { at, n: msgs.length, user, assistant, hasCanary: canary }))
}

/** Called from the probe's session.start hook, after next. */
export async function resumeAtStart($: EngineInterface): Promise<void> {
  if (await isOn($, 'resume')) await snapshot($, 'session.start')
}

export function registerResumeTurns(on: On): void {
  on('turn.start', async ($, e, next) => {
    const out = await next(e)
    if (e.agentId === undefined && !turnLogged && (await isOn($, 'resume'))) {
      turnLogged = true
      await snapshot($, 'turn.start')
    }
    return out
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const hold = e.agentId === undefined && !heldOnce && (await isOn($, 'resume')) && (await isOn($, 'resume-hold'))
    if (!hold) return yield* next(e)
    heldOnce = true
    await append($, await checkLine($, '0.3', { at: 'turn.step', held: true, messageCount: e.messageCount }))
    const held: TurnStepResult = {
      turnId: e.turnId,
      index: e.index,
      answer: 'step0-probe held this request (check 0.3)',
      toolUses: [],
      stopReason: 'end_turn',
      usage: null,
    }
    return held
  })
}
